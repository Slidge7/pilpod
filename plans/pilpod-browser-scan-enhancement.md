# PilPod — Browser Scan Enhancement Plan

> **Target:** `src-tauri/src/browser_catalog.rs`, `browser_detector.rs`, `browser_icon.rs`, `gsmtc/dto.rs`, `browser_commands.rs`
> **Executor:** Cursor Agent (Claude Sonnet)
> **Scope:** Optimise and extend the OS-level browser scan — broader coverage, richer state, extension awareness, cleaner internals.

---

## 0. Guiding Principles

1. **Catalog-first** — every browser fact lives in `CATALOG`; no logic outside it.
2. **Single scan pass** — one Toolhelp snapshot per cycle; no redundant enumerations.
3. **Minimal lock contention** — compute outside the mutex, swap atomically inside.
4. **Explicit state machine** — replace the boolean `running` with a typed `BrowserStatus` enum.
5. **Extension awareness belongs in the scan** — the `extension_installed` flag must be a first-class field on `DetectedBrowserInfo`, not grafted on during merge.
6. **No silent failures** — errors are logged with context; never swallowed.

---

## 1. Coverage Gaps — Expand the Catalog

### 1.1 Browsers to add

| ID | Display Name | `process_exe` | Detection hint |
|----|--------------|---------------|----------------|
| `zen` | Zen Browser | `zen.exe` | Uninstall key `Zen Browser` |
| `floorp` | Floorp | `floorp.exe` | Uninstall key `Floorp` |
| `thorium` | Thorium | `thorium.exe` | App Paths fallback |
| `pale_moon` | Pale Moon | `palemoon.exe` | StartMenuInternet `"Pale Moon"` |
| `basilisk` | Basilisk | `basilisk.exe` | Uninstall key |
| `whale` | Naver Whale | `whale.exe` | StartMenuInternet `"Naver Whale"` |
| `avast_secure` | Avast Secure Browser | `AvastBrowser.exe` | StartMenuInternet `"Avast Secure Browser"` |
| `cent` | CentBrowser | `centbrowser.exe` | App Paths |
| `maxthon` | Maxthon | `maxthon.exe` | StartMenuInternet `"Maxthon"` |
| `slimjet` | Slimjet | `slimjet.exe` | StartMenuInternet |
| `coc_coc` | Cốc Cốc | `browser.exe` | Path marker `coccoc` (disambiguate from Yandex) |
| `uc_browser` | UC Browser | `UCBrowser.exe` | StartMenuInternet `"UC Browser"` |

### 1.2 Rules for adding catalog entries

```rust
// template — copy, fill, add to CATALOG in specificity order
BrowserCatalogEntry {
    id: "zen",
    display_name: "Zen Browser",
    process_exe: "zen.exe",
    registry_client_names: &["Zen Browser"],
    registry_key_prefixes: &[],
    install_path_reg: None,
    aumid_markers: &["ZenBrowser"],
    focus_window_hint: "zen",
    focus_caption_hints: &[],
    extension_name_aliases: &["Zen Browser"],
    process_path_markers: None,
    process_path_excludes: None,
}
```

> **Order rule:** entries that share a `process_exe` with another entry MUST appear before the more-generic one (same rule as Opera GX before Opera).

---

## 2. Richer State — Replace `running: bool` with `BrowserStatus`

### 2.1 New enum (add to `gsmtc/dto.rs` or a new `browser_state.rs`)

```rust
/// Lifecycle state of a detected browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrowserStatus {
    /// At least one process is running and has foreground activity.
    Active,
    /// Process is running but no foreground activity detected.
    Running,
    /// Installed but no process found.
    Installed,
    /// Process found but no registry/install entry (portable / just launched).
    Portable,
    /// Neither installed nor running — should not appear in output, kept for internal use.
    Unknown,
}
```

### 2.2 Update `DetectedBrowserInfo`

```rust
pub struct DetectedBrowserInfo {
    pub id: String,
    pub display_name: String,
    pub status: BrowserStatus,          // replaces `running: bool`
    pub extension_installed: bool,      // moved here from merge step
    pub extension_connected: bool,      // driven by HTTP bridge heartbeat
    pub process_count: u32,             // number of matching processes (useful for multi-profile)
    pub last_seen_running: Option<std::time::Instant>, // for "recently closed" UX
}
```

> **Migration:** Remove `running: bool` from `DetectedBrowserInfo`. Update all call sites. The merge step in `browser_detector.rs` reads `status` instead.

---

## 3. Single-Pass Process Scan

### Current problem
`scan_running_browsers()` and `scan_supplemental_installed()` both call into process/registry independently. The Toolhelp snapshot is created per scan cycle which is fine, but process path resolution via `OpenProcess` is called for every matching PID even when the browser was already confirmed.

### 3.1 Refactor `scan_running_browsers` to return richer data

```rust
struct RunningProcess {
    id: &'static str,       // catalog ID
    pid: u32,
    full_path: String,
    is_foreground: bool,    // see §3.2
}

fn scan_running_browsers() -> HashMap<&'static str, Vec<RunningProcess>> {
    // One CreateToolhelp32Snapshot call.
    // For each process entry:
    //   1. cheap exe-name filter against catalog set
    //   2. OpenProcess + QueryFullProcessImageNameW only for candidates
    //   3. match_running_process → catalog ID
    //   4. push into HashMap<id, Vec<RunningProcess>>
}
```

### 3.2 Foreground / Active detection

Use `GetForegroundWindow` + `GetWindowThreadProcessId` once per scan cycle:

```rust
fn foreground_browser_id(running: &HashMap<&'static str, Vec<RunningProcess>>) -> Option<&'static str> {
    let fg_pid = unsafe {
        let hwnd = GetForegroundWindow();
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        pid
    };
    running
        .iter()
        .find(|(_, procs)| procs.iter().any(|p| p.pid == fg_pid))
        .map(|(id, _)| *id)
}
```

This gives us `BrowserStatus::Active` vs `BrowserStatus::Running` at zero extra cost.

### 3.3 Assembling `BrowserStatus`

```rust
fn resolve_status(
    id: &str,
    installed: &HashSet<String>,
    running: &HashMap<&str, Vec<RunningProcess>>,
    active_id: Option<&str>,
) -> BrowserStatus {
    let is_running = running.contains_key(id);
    let is_installed = installed.contains(id);
    match (is_running, is_installed, Some(id) == active_id) {
        (true, _, true)  => BrowserStatus::Active,
        (true, true, _)  => BrowserStatus::Running,
        (true, false, _) => BrowserStatus::Portable,
        (false, true, _) => BrowserStatus::Installed,
        _                => BrowserStatus::Unknown,
    }
}
```

---

## 4. Extension Awareness in the Scan Layer

### Current problem
`extension_installed` is only set during `merge_detected_and_slots`, which means the OS scan result alone is incomplete. Any consumer that reads `DetectedBrowsersState` directly (e.g. `dev_scan_os_browsers`) gets stale extension data.

### 4.1 Pass `ext_store` into `build_detected_browsers`

```rust
pub fn build_detected_browsers(ext_store: &ExtensionStore) -> Vec<DetectedBrowserInfo> {
    let installed = scan_installed_browsers();
    let running_map = scan_running_browsers();
    let active_id = foreground_browser_id(&running_map);

    CATALOG
        .iter()
        .filter(|e| installed.contains(e.id) || running_map.contains_key(e.id))
        .map(|e| {
            let status = resolve_status(e.id, &installed, &running_map, active_id);
            DetectedBrowserInfo {
                id: e.id.to_string(),
                display_name: e.display_name.to_string(),
                status,
                extension_installed: ext_store.is_installed(e.id),
                extension_connected: ext_store.is_connected(e.id),
                process_count: running_map.get(e.id).map(|v| v.len() as u32).unwrap_or(0),
                last_seen_running: None, // updated by detector loop
            }
        })
        .collect()
}
```

### 4.2 `last_seen_running` tracking in the detector loop

Inside `spawn_detector`'s poll loop, carry a `HashMap<String, Instant>` of last-seen timestamps:

```rust
let mut last_seen: HashMap<String, Instant> = HashMap::new();

loop {
    std::thread::sleep(POLL_INTERVAL);
    let fresh = build_detected_browsers(&ext_store);

    // Update last_seen for currently running browsers
    for b in &fresh {
        if matches!(b.status, BrowserStatus::Running | BrowserStatus::Active) {
            last_seen.insert(b.id.clone(), Instant::now());
        }
    }

    // Attach last_seen to each entry
    let fresh_with_ts: Vec<_> = fresh.into_iter().map(|mut b| {
        b.last_seen_running = last_seen.get(&b.id).copied();
        b
    }).collect();

    // Change-detect and emit only if diff
    // ...
}
```

---

## 5. Change Detection — Only Emit When State Actually Changes

### Current problem
The detector compares the full `Vec<DetectedBrowserInfo>` via `PartialEq`. With richer structs (Instant fields, etc.) this becomes fragile.

### 5.1 Fingerprint-based diffing

```rust
#[derive(PartialEq, Eq, Hash)]
struct BrowserFingerprint {
    id: String,
    status: BrowserStatus,
    extension_installed: bool,
    extension_connected: bool,
    process_count: u32,
}

fn fingerprint(b: &DetectedBrowserInfo) -> BrowserFingerprint { ... }

fn has_changed(prev: &[DetectedBrowserInfo], next: &[DetectedBrowserInfo]) -> bool {
    let prev_fp: HashSet<_> = prev.iter().map(fingerprint).collect();
    let next_fp: HashSet<_> = next.iter().map(fingerprint).collect();
    prev_fp != next_fp
}
```

---

## 6. Poll Interval — Adaptive

A fixed 2s poll is wasteful when nothing is happening and slow when a browser opens.

### 6.1 Strategy

```
Normal interval   : 3 000 ms  (reduced from 2s, saves CPU in idle)
Fast interval     : 500 ms   (active for 10s after any status change)
```

```rust
const POLL_NORMAL_MS: u64 = 3_000;
const POLL_FAST_MS:   u64 =   500;
const FAST_WINDOW_S:  u64 =    10;

let mut fast_until: Option<Instant> = None;

loop {
    let interval = match fast_until {
        Some(t) if Instant::now() < t => POLL_FAST_MS,
        _ => { fast_until = None; POLL_NORMAL_MS }
    };
    std::thread::sleep(Duration::from_millis(interval));

    let fresh = build_detected_browsers(&ext_store);
    if has_changed(&prev, &fresh) {
        fast_until = Some(Instant::now() + Duration::from_secs(FAST_WINDOW_S));
        // update state + emit
    }
    prev = fresh;
}
```

---

## 7. Frontend DTO — Surface the New Fields

Update `DetectedBrowser` (the serialised frontend payload) in `gsmtc/dto.rs`:

```rust
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DetectedBrowser {
    pub id: String,
    pub os_browser_id: String,
    pub display_name: String,
    pub profile_label: Option<String>,
    pub status: BrowserStatus,              // was: running: bool
    pub extension_installed: bool,
    pub extension_connected: bool,
    pub process_count: u32,
    pub last_seen_running_secs_ago: Option<u64>, // seconds since last seen running
    pub tab_count: u32,
    pub tabs: Vec<crate::gsmtc::dto::TabInfo>,
    pub icon_url: Option<String>,
}
```

> **Note:** `last_seen_running` is converted to seconds-ago at serialisation time (no `Instant` in JSON).

---

## 8. Code Quality — Housekeeping Tasks

| # | Task | File | Why |
|---|------|------|-----|
| H1 | Extract `scan_installed_from_hive` helper into `browser_catalog.rs` | `browser_detector.rs` | Catalog owns registry knowledge |
| H2 | Replace `pub unsafe fn image_path_for_pid` with a safe wrapper that handles the `unsafe` block internally | `browser_catalog.rs` | Unsafe surface area reduction |
| H3 | Add `#[must_use]` to `build_detected_browsers` | `browser_detector.rs` | Prevents accidental discard |
| H4 | Consolidate the three supplemental install checks into a single iterator in `scan_supplemental_installed` | `browser_catalog.rs` | Remove duplication |
| H5 | Add unit tests for new `BrowserStatus` resolution logic | `browser_catalog.rs` / `browser_detector.rs` | Mirrors existing Opera GX/Tor tests |
| H6 | Add `tracing::debug!` spans around each scan phase | `browser_detector.rs` | Diagnose slow cycles in production |

---

## 9. Implementation Order for Cursor Agent

Execute phases in this order to keep the build green at every step:

```
Phase 1 — Types only (no logic change)
  - Add BrowserStatus enum to gsmtc/dto.rs
  - Add new fields to DetectedBrowserInfo (keep running: bool alongside temporarily)
  - Derive PartialEq, Eq on DetectedBrowserInfo for fingerprint step
  - Compile check ✓

Phase 2 — Catalog expansion
  - Add the 12 new entries to CATALOG in browser_catalog.rs
  - Add unit tests for their registry key / path matching
  - Compile + test ✓

Phase 3 — Scan refactor
  - Refactor scan_running_browsers → returns HashMap<&str, Vec<RunningProcess>>
  - Add foreground_browser_id()
  - Add resolve_status()
  - Update build_detected_browsers signature to accept &ExtensionStore
  - Remove running: bool from DetectedBrowserInfo
  - Fix all call sites (browser_detector.rs, dev_lab/mod.rs, browser_commands.rs)
  - Compile + test ✓

Phase 4 — Detector loop upgrade
  - Add last_seen tracking
  - Add fingerprint-based change detection
  - Add adaptive poll intervals
  - Compile + test ✓

Phase 5 — Frontend DTO
  - Update DetectedBrowser struct
  - Update merge_detected_and_slots to map new fields
  - Compile + frontend type-check ✓

Phase 6 — Housekeeping (H1–H6)
  - Apply each item independently
  - Compile + test after each ✓
```

---

## 10. Acceptance Criteria

| Criterion | How to verify |
|-----------|---------------|
| All 13 original browsers still detected | Existing unit tests pass |
| New catalog entries correctly matched | New unit tests added in Phase 2 |
| `status` correctly transitions Active → Running → Installed as browser is used/closed | Manual smoke test + `dev_scan_os_browsers` Dev Lab panel |
| `extension_installed` present on OS-only rows (no extension slot) | `dev_scan_os_browsers` returns correct flag |
| No emission on idle (nothing changed) | Add a counter to `spawn_detector` and assert it does not grow when nothing changes for 30s |
| Build compiles on Windows with no new warnings | CI |
| Non-Windows stub still compiles | CI (Linux runner) |

---

## 11. Out of Scope (Future Work)

- macOS/Linux scan (separate epic — requires `ps` / `launchd` / `xdg-open` approaches)
- Per-profile detection (multiple Chrome profiles → multiple rows)
- Extension version reporting
- Browser CPU/memory usage
