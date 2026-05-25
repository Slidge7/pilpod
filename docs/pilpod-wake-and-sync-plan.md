# PilPod — Implementation Plan: `dev_wake_and_sync_browser`

> **Scope**: Dev Lab only · Windows-only real impl · Minimal surface area · Reuse existing state

---

## 0. Overview

We add a single orchestrated Tauri command `dev_wake_and_sync_browser(os_browser_id)` that:

1. Resolves the browser exe path from the Windows registry
2. Launches the browser process **without stealing focus** (if not running)
3. Polls for extension WebSocket connection (up to 12 seconds)
4. Pushes `syncNow` once connected and waits for tab data
5. Returns a structured result to the Dev Lab UI

Frontend gets a **"Wake & Sync"** button per browser row that replaces (or supplements) "Scan tabs".

---

## 1. File Map — What Gets Touched

```
src-tauri/src/
├── dev_lab/
│   ├── mod.rs                  ← ADD: wake_and_sync command + orchestration
│   └── wake.rs                 ← NEW: exe resolution + no-focus launch
├── browser_detector.rs         ← OPTIONAL: expose exe path helper (or inline in wake.rs)
├── app/
│   └── handlers.rs             ← ADD: register new command under #[cfg(windows)]
└── platform/
    └── stub_commands.rs        ← ADD: non-Windows stub

src/features/dev-lab/
├── hooks/
│   └── useDevLabScans.ts       ← ADD: wakeAndSyncBrowser()
├── components/
│   ├── DevLabBrowserRow.tsx    ← ADD: Wake & Sync button + result display
│   └── DevLabBrowserRow.css    ← ADD: status pill styles
src/types/
└── media.ts                    ← ADD: DevWakeAndSyncResult type

pilpod-companion/src/background/transport/
└── wsTransport.js              ← OPTIONAL: faster reconnect on visibility/startup
```

---

## 2. Rust: `wake.rs` — Exe Resolution + No-Focus Launch

### 2.1 Registry Exe Path Resolution

The Windows registry key `HKLM\SOFTWARE\Clients\StartMenuInternet\{name}\shell\open\command` holds the launch command string for each registered browser.

```rust
// src-tauri/src/dev_lab/wake.rs

use winreg::{enums::*, RegKey};

/// Maps OS browser id → known registry client names to try (ordered by likelihood)
fn registry_names_for(os_id: &str) -> &'static [&'static str] {
    match os_id {
        "chrome"   => &["Google Chrome"],
        "msedge"   => &["Microsoft Edge"],
        "firefox"  => &["Mozilla Firefox"],
        "brave"    => &["Brave Browser"],
        "opera"    => &["Opera Stable", "Opera"],
        "vivaldi"  => &["Vivaldi"],
        "chromium" => &["Chromium"],
        "arc"      => &["Arc"],
        _          => &[],
    }
}

pub fn resolve_exe_path(os_browser_id: &str) -> Option<String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let base = "SOFTWARE\\Clients\\StartMenuInternet";

    for name in registry_names_for(os_browser_id) {
        let key_path = format!("{}\\{}\\shell\\open\\command", base, name);
        if let Ok(key) = hklm.open_subkey(&key_path) {
            if let Ok(val) = key.get_value::<String, _>("") {
                // Strip surrounding quotes if present: `"C:\...\chrome.exe" -- "%1"`
                let exe = val.trim().trim_start_matches('"');
                let exe = exe.split('"').next().unwrap_or(exe);
                let exe = exe.split(" --").next().unwrap_or(exe).trim().to_string();
                if !exe.is_empty() {
                    return Some(exe);
                }
            }
        }
    }

    // Fallback: try HKCU (per-user installs like Opera GX)
    if let Ok(hkcu_base) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(base)
    {
        for name in registry_names_for(os_browser_id) {
            let key_path = format!("{}\\shell\\open\\command", name);
            if let Ok(key) = hkcu_base.open_subkey(&key_path) {
                if let Ok(val) = key.get_value::<String, _>("") {
                    let exe = val.trim().trim_start_matches('"');
                    let exe = exe.split('"').next().unwrap_or(exe);
                    let exe = exe.split(" --").next().unwrap_or(exe).trim().to_string();
                    if !exe.is_empty() {
                        return Some(exe);
                    }
                }
            }
        }
    }

    None
}
```

**Dependency**: add `winreg = "0.52"` to `src-tauri/Cargo.toml` if not already present.

---

### 2.2 No-Focus Process Launch

We use `CreateProcessW` with `STARTF_USESHOWWINDOW` + `SW_SHOWNOACTIVATE` so the browser window appears (or stays hidden on headless start) without stealing focus from the current foreground window.

```rust
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::System::Threading::*;
use windows_sys::Win32::Foundation::BOOL;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE;

pub fn launch_no_focus(exe_path: &str) -> Result<(), String> {
    let wide: Vec<u16> = OsStr::new(exe_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut si: STARTUPINFOW = unsafe { std::mem::zeroed() };
    si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_SHOWNOACTIVATE as u16;  // show without activating

    let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    let result: BOOL = unsafe {
        CreateProcessW(
            wide.as_ptr(),
            std::ptr::null_mut(),   // lpCommandLine
            std::ptr::null_mut(),   // lpProcessAttributes
            std::ptr::null_mut(),   // lpThreadAttributes
            0,                      // bInheritHandles = FALSE
            NORMAL_PRIORITY_CLASS,  // dwCreationFlags — no CREATE_NO_WINDOW (we want browser to open)
            std::ptr::null_mut(),   // lpEnvironment
            std::ptr::null_mut(),   // lpCurrentDirectory
            &si,
            &mut pi,
        )
    };

    if result == 0 {
        let err = unsafe { windows_sys::Win32::Foundation::GetLastError() };
        return Err(format!("CreateProcessW failed: error code {}", err));
    }

    // Close handles immediately — we don't track the child process
    unsafe {
        windows_sys::Win32::Foundation::CloseHandle(pi.hProcess);
        windows_sys::Win32::Foundation::CloseHandle(pi.hThread);
    }

    Ok(())
}
```

**Key point**: `SW_SHOWNOACTIVATE` renders the window without giving it focus. `NORMAL_PRIORITY_CLASS` keeps scheduling fair. We do NOT use `CREATE_NO_WINDOW` here because we want the browser UI to appear — just not to steal focus.

**Dependency**: `windows-sys` is already a Tauri transitive dep on Windows. If you need explicit feature flags:
```toml
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.52", features = ["Win32_System_Threading", "Win32_UI_WindowsAndMessaging", "Win32_Foundation"] }
```

---

## 3. Rust: `dev_lab/mod.rs` — Orchestration Command

### 3.1 DTOs

```rust
// src-tauri/src/dev_lab/mod.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DevBrowserTabProfile {
    pub browser_id: String,           // UUID or OS placeholder id
    pub os_browser_id: String,
    pub extension_connected: bool,
    pub tab_count: usize,
    pub tabs: Vec<serde_json::Value>, // reuse existing BrowserTab serialization
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DevWakeAndSyncResult {
    pub os_browser_id: String,
    pub was_running: bool,            // process existed before we acted
    pub launched: bool,               // we started it via CreateProcessW
    pub connected: bool,              // at least one profile connected during poll
    pub timed_out: bool,
    pub wait_ms: u64,
    pub profiles: Vec<DevBrowserTabProfile>,
    pub error: Option<String>,
}
```

### 3.2 Command Implementation

```rust
#[tauri::command]
#[cfg(windows)]
pub async fn dev_wake_and_sync_browser(
    os_browser_id: String,
    // Inject existing state handles
    browsers_state: tauri::State<'_, DetectedBrowsersState>,
    slots_map: tauri::State<'_, BrowserSlotsMap>,
    ext_installed: tauri::State<'_, ExtensionInstalledState>,
    ws_connections: tauri::State<'_, WsConnectionMap>,
    sync_flag: tauri::State<'_, SyncRequestedFlag>,
    app_handle: tauri::AppHandle,
) -> Result<DevWakeAndSyncResult, String> {

    // Must run on a blocking thread — window + process ops block the WebView thread
    let os_id = os_browser_id.clone();
    let browsers_state = browsers_state.inner().clone();
    let slots_map = slots_map.inner().clone();
    let ws_connections = ws_connections.inner().clone();
    let sync_flag = sync_flag.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        wake_and_sync_impl(
            &os_id,
            &browsers_state,
            &slots_map,
            &ws_connections,
            &sync_flag,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
```

### 3.3 Core Orchestration (`wake_and_sync_impl`)

```rust
const POLL_INTERVAL_MS: u64 = 500;
const POLL_TIMEOUT_MS: u64 = 12_000;
const POST_CONNECT_WAIT_MS: u64 = 1_500; // wait for tab push after syncNow

fn wake_and_sync_impl(
    os_browser_id: &str,
    browsers_state: &DetectedBrowsersState,
    slots_map: &BrowserSlotsMap,
    ws_connections: &WsConnectionMap,
    sync_flag: &SyncRequestedFlag,
) -> Result<DevWakeAndSyncResult, String> {

    // ── STEP 1: Check current running state ─────────────────────────────────
    let was_running = is_browser_running(os_browser_id, browsers_state);
    let mut launched = false;

    // ── STEP 2: Guard — extension installed? ────────────────────────────────
    // If not installed, skip wake entirely and return early
    let ext_installed_for_browser = ext_installed_state_for(os_browser_id);
    if !ext_installed_for_browser {
        return Ok(DevWakeAndSyncResult {
            os_browser_id: os_browser_id.to_string(),
            was_running,
            launched: false,
            connected: false,
            timed_out: false,
            wait_ms: 0,
            profiles: collect_profiles(os_browser_id, slots_map),
            error: Some("Extension not installed for this browser".to_string()),
        });
    }

    // ── STEP 3: Wake if needed ───────────────────────────────────────────────
    if !was_running {
        match crate::dev_lab::wake::resolve_exe_path(os_browser_id) {
            Some(exe) => {
                crate::dev_lab::wake::launch_no_focus(&exe)
                    .map_err(|e| e)?;
                launched = true;
            }
            None => {
                return Ok(DevWakeAndSyncResult {
                    os_browser_id: os_browser_id.to_string(),
                    was_running,
                    launched: false,
                    connected: false,
                    timed_out: false,
                    wait_ms: 0,
                    profiles: vec![],
                    error: Some(format!("Cannot resolve exe path for '{}'", os_browser_id)),
                });
            }
        }
    }
    // If already running but extension offline — no OS action; poll will handle it.
    // The extension reconnects on its own 3s cycle (see § 8 for improving this).

    // ── STEP 4: Poll for connection ──────────────────────────────────────────
    let start = std::time::Instant::now();
    let mut connected = false;

    loop {
        if is_any_profile_connected(os_browser_id, slots_map, ws_connections) {
            connected = true;
            break;
        }
        if start.elapsed().as_millis() as u64 >= POLL_TIMEOUT_MS {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));
    }

    let wait_ms = start.elapsed().as_millis() as u64;

    // ── STEP 5: Sync if connected ────────────────────────────────────────────
    if connected {
        sync_flag.store(true, std::sync::atomic::Ordering::Relaxed);
        push_ws_sync_all(ws_connections);

        // Wait briefly for tabs to arrive via WS push
        std::thread::sleep(std::time::Duration::from_millis(POST_CONNECT_WAIT_MS));
    }

    // ── STEP 6: Collect final profiles ──────────────────────────────────────
    let profiles = collect_profiles(os_browser_id, slots_map);

    Ok(DevWakeAndSyncResult {
        os_browser_id: os_browser_id.to_string(),
        was_running,
        launched,
        connected,
        timed_out: !connected,
        wait_ms,
        profiles,
        error: None,
    })
}
```

### 3.4 Helper: `is_any_profile_connected`

```rust
fn is_any_profile_connected(
    os_browser_id: &str,
    slots_map: &BrowserSlotsMap,
    ws_connections: &WsConnectionMap,
) -> bool {
    let connected_ids = ws_connected_ids(ws_connections); // existing fn
    let slots = slots_map.read().unwrap();

    slots.values().any(|slot| {
        slot.os_browser_id.as_deref() == Some(os_browser_id)
            && (connected_ids.contains(&slot.id) || slot.is_recently_seen())
        // is_recently_seen() = last_seen within CONNECTED_WINDOW_SECS
    })
}
```

### 3.5 Helper: `collect_profiles`

```rust
fn collect_profiles(os_browser_id: &str, slots_map: &BrowserSlotsMap) -> Vec<DevBrowserTabProfile> {
    let slots = slots_map.read().unwrap();
    slots
        .values()
        .filter(|s| s.os_browser_id.as_deref() == Some(os_browser_id))
        .map(|s| DevBrowserTabProfile {
            browser_id: s.id.clone(),
            os_browser_id: os_browser_id.to_string(),
            extension_connected: s.is_recently_seen(),
            tab_count: s.tabs.len(),
            tabs: s.tabs.iter().map(|t| serde_json::to_value(t).unwrap_or_default()).collect(),
        })
        .collect()
}
```

---

## 4. Register Command in `handlers.rs`

```rust
// src-tauri/src/app/handlers.rs

#[cfg(windows)]
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        // ... existing commands ...
        crate::dev_lab::dev_wake_and_sync_browser,
    ])
```

```rust
// src-tauri/src/platform/stub_commands.rs  (non-Windows)

#[tauri::command]
#[cfg(not(windows))]
pub async fn dev_wake_and_sync_browser(
    os_browser_id: String,
) -> Result<serde_json::Value, String> {
    Err(format!("dev_wake_and_sync_browser is Windows-only (requested: {})", os_browser_id))
}
```

---

## 5. Frontend Types

```typescript
// src/types/media.ts — append

export interface DevBrowserTabProfile {
  browserId: string;
  osBrowserId: string;
  extensionConnected: boolean;
  tabCount: number;
  tabs: BrowserTab[];
}

export interface DevWakeAndSyncResult {
  osBrowserId: string;
  wasRunning: boolean;
  launched: boolean;
  connected: boolean;
  timedOut: boolean;
  waitMs: number;
  profiles: DevBrowserTabProfile[];
  error: string | null;
}
```

---

## 6. Frontend Hook: `useDevLabScans.ts`

Add alongside the existing `scanTabsForBrowser`:

```typescript
// src/features/dev-lab/hooks/useDevLabScans.ts

import { invoke } from "@tauri-apps/api/core";
import { DevWakeAndSyncResult } from "../../../types/media";

// State addition
const [wakeResults, setWakeResults] = useState<
  Record<string, DevWakeAndSyncResult>
>({});
const [wakingBrowsers, setWakingBrowsers] = useState<Set<string>>(new Set());

const wakeAndSyncBrowser = async (osBrowserId: string) => {
  setWakingBrowsers((prev) => new Set(prev).add(osBrowserId));

  try {
    const result = await invoke<DevWakeAndSyncResult>(
      "dev_wake_and_sync_browser",
      { osBrowserId }
    );

    setWakeResults((prev) => ({ ...prev, [osBrowserId]: result }));

    // Refresh the full browser list so the main panel reflects new tabs
    const updated = await invoke<DetectedBrowser[]>("get_browsers");
    setBrowsers(updated); // or however the hook surfaces browser list
  } catch (err) {
    setWakeResults((prev) => ({
      ...prev,
      [osBrowserId]: {
        osBrowserId,
        wasRunning: false,
        launched: false,
        connected: false,
        timedOut: false,
        waitMs: 0,
        profiles: [],
        error: String(err),
      },
    }));
  } finally {
    setWakingBrowsers((prev) => {
      const next = new Set(prev);
      next.delete(osBrowserId);
      return next;
    });
  }
};

return {
  // ... existing returns ...
  wakeAndSyncBrowser,
  wakeResults,
  wakingBrowsers,
};
```

---

## 7. Frontend Component: `DevLabBrowserRow.tsx`

### 7.1 Add Wake & Sync Button

```tsx
// DevLabBrowserRow.tsx — inside the browser row actions area

const { wakeAndSyncBrowser, wakeResults, wakingBrowsers } = useDevLabScans();
const wakeResult = wakeResults[browser.osBrowserId];
const isWaking = wakingBrowsers.has(browser.osBrowserId);

<button
  className="dev-lab-btn dev-lab-btn--wake"
  disabled={isWaking}
  onClick={() => wakeAndSyncBrowser(browser.osBrowserId)}
>
  {isWaking ? "Waking…" : "Wake & Sync"}
</button>
```

### 7.2 Result Status Pill

```tsx
{wakeResult && (
  <div className="wake-result">
    <span className={`wake-pill wake-pill--${wakeResult.connected ? "ok" : wakeResult.timedOut ? "timeout" : "err"}`}>
      {wakeResult.connected
        ? `✓ Connected (${wakeResult.waitMs}ms)`
        : wakeResult.timedOut
        ? `✗ Timed out (${wakeResult.waitMs}ms)`
        : `✗ ${wakeResult.error ?? "Error"}`}
    </span>
    {wakeResult.launched && <span className="wake-pill wake-pill--info">Launched</span>}
    {wakeResult.profiles.map((p) => (
      <span key={p.browserId} className="wake-pill wake-pill--tabs">
        {p.tabCount} tab{p.tabCount !== 1 ? "s" : ""}
      </span>
    ))}
  </div>
)}
```

### 7.3 CSS (`DevLabBrowserRow.css`)

```css
.dev-lab-btn--wake {
  background: var(--color-amber, #f59e0b);
  color: #000;
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.75rem;
  cursor: pointer;
}
.dev-lab-btn--wake:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wake-result { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.wake-pill {
  font-family: "IBM Plex Mono", monospace;
  font-size: 0.68rem;
  padding: 2px 7px;
  border-radius: 3px;
}
.wake-pill--ok      { background: #14532d; color: #86efac; }
.wake-pill--timeout { background: #431407; color: #fdba74; }
.wake-pill--err     { background: #450a0a; color: #fca5a5; }
.wake-pill--info    { background: #1e3a5f; color: #93c5fd; }
.wake-pill--tabs    { background: #1c1917; color: #a8a29e; }
```

### 7.4 UUID Transition Handling

After a successful wake, the OS placeholder row (`id == "opera"`) is replaced by a UUID row. The hook refreshes `get_browsers` post-sync, which naturally picks up the new UUID profile. No special UI handling needed — the row re-renders with the real UUID profile.

---

## 8. Optional: Faster Reconnect in Companion Extension

The MV3 service worker sleeps after `FAIL_THRESHOLD = 4` failures and only retries after `SLEEP_INTERVAL_MS = 5000ms`. If the browser was already running but the extension was offline, our poll may expire before the extension wakes.

**Recommended change** in `wsTransport.js`:

```javascript
// Reduce sleep after failure burst when browser is visibly active
const SLEEP_INTERVAL_MS = 2000; // was 5000

// Add chrome.runtime.onStartup listener to reconnect immediately on browser start
chrome.runtime.onStartup.addListener(() => {
  this.#wakeAndRetry();
});

// Add chrome.alarms-based keepalive to prevent service worker suspension
chrome.alarms.create("pilpod-keepalive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "pilpod-keepalive" && !this.#ws) {
    this.#wakeAndRetry();
  }
});
```

This is a **best-effort improvement** only — do not block the Rust feature on it.

---

## 9. Error & Timeout Handling Summary

| Scenario | Behavior |
|---|---|
| Extension not installed | Return immediately with `error: "Extension not installed"` — no launch |
| Exe path not found in registry | Return `error: "Cannot resolve exe path"` |
| `CreateProcessW` fails | Return `error: "CreateProcessW failed: error code N"` |
| Browser launches, extension never connects within 12s | `timed_out: true`, `connected: false`, `profiles: []` |
| Browser already running, extension offline | Poll 12s — best effort; `timed_out: true` if no reconnect |
| Browser running + extension live | Skip launch, push `syncNow` immediately, return tabs |
| Multiple profiles (same OS id, multiple UUIDs) | All are synced via `push_ws_sync_all`; all returned in `profiles[]` |

---

## 10. Manual Test Plan

| # | Scenario | Steps | Expected |
|---|---|---|---|
| T1 | Cold launch | Close Opera, click Wake & Sync | `launched: true`, Opera opens (no focus), tabs returned within timeout |
| T2 | Already running + live extension | Chrome open + connected, click Wake & Sync | `launched: false`, `wasRunning: true`, tabs returned quickly |
| T3 | Running + offline extension | Kill extension reload manually, click Wake & Sync | `connected` depends on reconnect timer; `timed_out: true` if extension stays offline |
| T4 | Extension not installed | Browser without extension, click Wake & Sync | Error pill: "Extension not installed" |
| T5 | Browser not installed | Unknown/uninstalled browser id | Error pill: "Cannot resolve exe path" |
| T6 | Multiple profiles | Two Chrome profiles, both connected | `profiles` array has two entries with combined tab counts |
| T7 | Focus check | Run T1 while editing a text file | Cursor stays in text editor — browser opens behind |
| T8 | Timeout UX | Disable extension, click Wake & Sync | Loading state for ~12s, then `timed_out` pill |

---

## 11. Risks & Guarantees

### Guaranteed
- Browser will be launched if exe path resolves and process not running
- Focus will not be stolen (`SW_SHOWNOACTIVATE`)
- `syncNow` will be pushed if connection is established
- Non-Windows builds will not compile broken code (stub in place)
- Dev Lab isolation: zero impact on main dashboard

### Best-Effort
- Extension connects within 12s — depends on MV3 service worker wake time (typically 1–4s on browser start; slower if already-running SW is sleeping)
- Tabs arrive within `POST_CONNECT_WAIT_MS` — depends on extension `#push()` timing
- Registry path lookup covers all 8 known browsers — exotic/portable installs may have no registry entry

### Known Gaps
- **Firefox**: Uses a different IPC model; extension reconnect behavior may differ from Chromium
- **Opera GX**: Uses a separate registry hive and possibly a different client name — test separately
- **Portable browsers**: No registry entry → `resolve_exe_path` returns `None` → clear error returned

---

## 12. Implementation Order (Cursor Tasks)

1. `src-tauri/src/dev_lab/wake.rs` — `resolve_exe_path` + `launch_no_focus`
2. `src-tauri/src/dev_lab/mod.rs` — DTOs + `wake_and_sync_impl` + `dev_wake_and_sync_browser` command
3. `src-tauri/src/app/handlers.rs` — register command
4. `src-tauri/src/platform/stub_commands.rs` — non-Windows stub
5. `src/types/media.ts` — `DevWakeAndSyncResult` + `DevBrowserTabProfile`
6. `src/features/dev-lab/hooks/useDevLabScans.ts` — `wakeAndSyncBrowser` + state
7. `src/features/dev-lab/components/DevLabBrowserRow.tsx` — button + status pills
8. `src/features/dev-lab/components/DevLabBrowserRow.css` — styles
9. *(Optional)* `pilpod-companion/src/background/transport/wsTransport.js` — faster reconnect

> **Do steps 1–4 before touching the frontend.** Type-check the Tauri command signature before wiring the invoke call.
