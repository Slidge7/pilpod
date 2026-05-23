//! OS-level browser detection: Windows registry scan + running process enumeration.
//!
//! Produces a `Vec<DetectedBrowserInfo>` of installed and/or running browsers,
//! entirely independent of the companion extension.  The extension's role is narrowed
//! to tab reporting: the HTTP bridge marks `extension_installed = true` on a
//! `DetectedBrowser` when it receives a POST from that browser.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::browser_tabs::{BrowserSlot, BrowserSlotsMap};
use crate::browser_bridge::connections::{ws_connected_ids, WsConnectionMap};
use crate::browser_bridge::CONNECTED_WINDOW_SECS;
use crate::gsmtc::dto::{DetectedBrowser, DetectedBrowserInfo};

/// Event name emitted to the frontend when the browser list changes.
pub const BROWSERS_UPDATE_EVENT: &str = "browsers://update";

/// Well-known browser process names, stable ids, and display names.
/// Order matters: first match wins for process-name → id lookups.
const KNOWN_BROWSERS: &[(&str, &str, &str)] = &[
    ("chrome.exe",   "chrome",   "Google Chrome"),
    ("msedge.exe",   "msedge",   "Microsoft Edge"),
    ("firefox.exe",  "firefox",  "Mozilla Firefox"),
    ("brave.exe",    "brave",    "Brave"),
    ("opera.exe",    "opera",    "Opera"),
    ("vivaldi.exe",  "vivaldi",  "Vivaldi"),
    ("chromium.exe", "chromium", "Chromium"),
    ("arc.exe",      "arc",      "Arc"),
];

/// Shared OS-detected browser list (updated by the detector background thread).
pub type DetectedBrowsersState = Arc<Mutex<Vec<DetectedBrowserInfo>>>;

// ── Persistent extension-installed store ─────────────────────────────────────

/// Persisted map of OS browser ID → whether the companion extension has ever
/// successfully connected.  Written to the app data directory as JSON.
///
/// This decouples "extension is installed" from "extension heartbeat arrived in
/// the last 3 s", preventing the false-negative flicker that occurred when a
/// heartbeat was briefly missed.
#[derive(Default, Serialize, Deserialize)]
pub struct ExtensionInstalledStore {
    #[serde(flatten)]
    installed: HashMap<String, bool>,

    #[serde(skip)]
    path: PathBuf,
}

impl ExtensionInstalledStore {
    /// Load from `{app_data_dir}/browser_ext_state.json`, or start empty.
    pub fn load(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("browser_ext_state.json");

        let installed: HashMap<String, bool> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        Self { installed, path }
    }

    pub fn is_installed(&self, browser_id: &str) -> bool {
        self.installed.get(browser_id).copied().unwrap_or(false)
    }

    /// Mark `browser_id` as having the extension installed.
    /// Returns `true` if the state changed (and the file was written).
    pub fn mark_installed(&mut self, browser_id: &str) -> bool {
        if self.installed.get(browser_id).copied().unwrap_or(false) {
            return false; // already known — skip the write
        }
        self.installed.insert(browser_id.to_string(), true);
        self.save();
        true
    }

    fn save(&self) {
        // Serialize only the map, not the path.
        if let Ok(json) = serde_json::to_string_pretty(&self.installed) {
            if let Some(dir) = self.path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Err(e) = std::fs::write(&self.path, json) {
                eprintln!("[browser-detector] failed to persist state: {e}");
            }
        }
    }
}

/// Shared, thread-safe handle to the persistence store.
pub type ExtensionInstalledState = Arc<Mutex<ExtensionInstalledStore>>;

/// Shared set of extension `browserId` UUIDs awaiting reconnect after system resume.
pub type ReconnectingBrowsersState = Arc<Mutex<HashSet<String>>>;

pub fn new_reconnecting_state() -> ReconnectingBrowsersState {
    Arc::new(Mutex::new(HashSet::new()))
}

/// Remove a browser from the reconnecting set. Returns true if it was present.
pub fn clear_reconnecting(state: &ReconnectingBrowsersState, browser_id: &str) -> bool {
    state
        .lock()
        .ok()
        .map_or(false, |mut set| set.remove(browser_id))
}

// ── Stable-id helpers ────────────────────────────────────────────────────────

/// Map a browser name reported by the extension to a stable lower-case id.
/// Falls back to the lower-cased name when no known browser matches.
pub fn browser_name_to_id(name: &str) -> String {
    let n = name.trim().to_lowercase();
    for (_, id, display) in KNOWN_BROWSERS {
        if n == *id || n == display.to_lowercase() {
            return id.to_string();
        }
    }
    n
}

// ── OS scanning ──────────────────────────────────────────────────────────────

/// Enumerate running browser processes via the Windows toolhelp snapshot API.
fn scan_running_browsers() -> HashSet<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let mut running = HashSet::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return running;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name =
                    String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();
                for (exe, id, _) in KNOWN_BROWSERS {
                    if name == *exe {
                        running.insert(id.to_string());
                    }
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    running
}

/// Read installed browsers from `HKLM\SOFTWARE\Clients\StartMenuInternet`.
fn scan_installed_browsers() -> HashSet<String> {
    let mut installed = HashSet::new();
    let hklm = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
    if let Ok(key) = hklm.open_subkey("SOFTWARE\\Clients\\StartMenuInternet") {
        for name_result in key.enum_keys() {
            if let Ok(name) = name_result {
                let lower = name.to_lowercase();
                for (exe, id, display) in KNOWN_BROWSERS {
                    let exe_stem = exe.replace(".exe", "");
                    if lower.contains(&exe_stem)
                        || lower.contains(*id)
                        || lower.contains(&display.to_lowercase())
                    {
                        installed.insert(id.to_string());
                    }
                }
            }
        }
    }
    installed
}

/// Build the current detected-browser list from both registry and running processes.
pub fn build_detected_browsers() -> Vec<DetectedBrowserInfo> {
    let installed = scan_installed_browsers();
    let running = scan_running_browsers();

    KNOWN_BROWSERS
        .iter()
        .filter(|(_, id, _)| installed.contains(*id) || running.contains(*id))
        .map(|(_, id, name)| DetectedBrowserInfo {
            id: id.to_string(),
            display_name: name.to_string(),
            running: running.contains(*id),
        })
        .collect()
}

// ── Merging ──────────────────────────────────────────────────────────────────

/// Merge OS-detected browsers with extension slots into the frontend view.
///
/// **Design principles (Phase 2):**
///
/// - One row per extension profile UUID (`BrowserSlot`), not per OS browser executable.
/// - OS-detected browsers without any slot get a placeholder row keyed by OS id.
/// - `extension_installed` — persisted flag keyed by OS id; never flips off on missed heartbeats.
/// - `extension_connected` — WS socket presence when WS is active; heartbeat freshness as fallback.
/// - Cached tabs are always shown for slots regardless of freshness.
pub fn merge_detected_and_slots(
    detected: &[DetectedBrowserInfo],
    slots: &HashMap<String, BrowserSlot>,
    ext_store: &ExtensionInstalledStore,
    reconnecting: &HashSet<String>,
    ws_connected: &HashSet<String>,
) -> Vec<DetectedBrowser> {
    let slot_active_cutoff = Duration::from_secs(CONNECTED_WINDOW_SECS);
    let now = std::time::Instant::now();

    let detected_by_id: HashMap<&str, &DetectedBrowserInfo> =
        detected.iter().map(|d| (d.id.as_str(), d)).collect();

    let mut slots_per_os: HashMap<String, usize> = HashMap::new();
    for slot in slots.values() {
        let os_id = browser_name_to_id(&slot.browser_name);
        *slots_per_os.entry(os_id).or_insert(0) += 1;
    }

    let mut result: Vec<DetectedBrowser> = Vec::new();
    let mut os_ids_with_slots: HashSet<String> = HashSet::new();

    // Pass B: one row per extension profile slot.
    for slot in slots.values() {
        let os_id = browser_name_to_id(&slot.browser_name);
        os_ids_with_slots.insert(os_id.clone());

        let os_info = detected_by_id.get(os_id.as_str());
        let running = os_info.map(|d| d.running).unwrap_or(true);
        let base_display = os_info
            .map(|d| d.display_name.clone())
            .unwrap_or_else(|| slot.browser_name.clone());

        let slot_age_secs = now.duration_since(slot.last_seen).as_secs();
        let is_fresh = now.duration_since(slot.last_seen) < slot_active_cutoff;
        let ws_up = ws_connected.contains(&slot.browser_id);
        let extension_connected = ws_up || is_fresh;
        let extension_reconnecting =
            reconnecting.contains(&slot.browser_id) && !ws_up;

        let profile_label = if slots_per_os.get(&os_id).copied().unwrap_or(0) > 1 {
            let prefix = slot
                .browser_id
                .get(..8)
                .unwrap_or(&slot.browser_id);
            Some(format!("{base_display} · Profile {prefix}"))
        } else {
            None
        };

        result.push(DetectedBrowser {
            id: slot.browser_id.clone(),
            os_browser_id: os_id.clone(),
            display_name: base_display,
            profile_label,
            running,
            extension_installed: ext_store.is_installed(&os_id),
            extension_connected,
            tab_count: slot.tabs.len() as u32,
            tabs: slot.tabs.clone(),
            last_sync_secs: Some(slot_age_secs),
            extension_reconnecting,
        });
    }

    // Pass A: OS-detected browsers with no extension slot yet.
    for d in detected {
        if os_ids_with_slots.contains(&d.id) {
            continue;
        }
        result.push(DetectedBrowser {
            id: d.id.clone(),
            os_browser_id: d.id.clone(),
            display_name: d.display_name.clone(),
            profile_label: None,
            running: d.running,
            extension_installed: ext_store.is_installed(&d.id),
            extension_connected: false,
            tab_count: 0,
            tabs: Vec::new(),
            last_sync_secs: None,
            extension_reconnecting: false,
        });
    }

    let (with_ext, without_ext): (Vec<_>, Vec<_>) =
        result.into_iter().partition(|b| b.extension_installed);
    with_ext.into_iter().chain(without_ext).collect()
}

/// Returns the set of browser stable IDs (e.g. `"chrome"`, `"brave"`) for every
/// browser whose companion extension sent a POST within the last 3 seconds.
///
/// This is intentionally narrower than [`crate::browser_tabs::has_active_extension`],
/// which returns a single bool for *any* browser.  The GSMTC dedup uses these IDs
/// to suppress only the specific browsers that are represented by the extension,
/// leaving browsers without the extension (e.g. Brave when only Chrome is connected)
/// visible in the Windows section.
pub fn active_extension_browser_ids(slots: &HashMap<String, BrowserSlot>) -> HashSet<String> {
    let cutoff = Duration::from_secs(CONNECTED_WINDOW_SECS);
    let now = std::time::Instant::now();
    slots
        .values()
        .filter(|slot| now.duration_since(slot.last_seen) < cutoff)
        .map(|slot| browser_name_to_id(&slot.browser_name))
        .collect()
}

// ── Emission ─────────────────────────────────────────────────────────────────

/// Build and emit the merged browser list to the frontend on `"browsers://update"`.
pub fn emit_browsers_to_ui(
    app: &AppHandle,
    detected: &DetectedBrowsersState,
    slots: &BrowserSlotsMap,
    ext_store: &ExtensionInstalledState,
    reconnecting: &ReconnectingBrowsersState,
    ws_connections: &WsConnectionMap,
) {
    let detected_list = detected
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let slots_map = slots.lock().unwrap_or_else(|e| e.into_inner());
    let store = ext_store.lock().unwrap_or_else(|e| e.into_inner());
    let reconnecting_set = reconnecting.lock().unwrap_or_else(|e| e.into_inner());
    let ws_connected = ws_connected_ids(ws_connections);

    let browsers = merge_detected_and_slots(
        &detected_list,
        &*slots_map,
        &*store,
        &*reconnecting_set,
        &ws_connected,
    );

    if let Err(e) = app.emit(BROWSERS_UPDATE_EVENT, &browsers) {
        eprintln!("[browser-detector] emit failed: {e}");
    }
}

/// Re-emit the browser list after a WS connect/disconnect lifecycle change.
pub fn emit_on_connection_change(
    app: &AppHandle,
    detected: &DetectedBrowsersState,
    slots: &BrowserSlotsMap,
    ext_store: &ExtensionInstalledState,
    reconnecting: &ReconnectingBrowsersState,
    ws_connections: &WsConnectionMap,
) {
    emit_browsers_to_ui(app, detected, slots, ext_store, reconnecting, ws_connections);
}

// ── Background thread ────────────────────────────────────────────────────────

/// Spawn a background thread that polls for OS browser changes every 2 seconds.
/// Emits `"browsers://update"` whenever the installed/running browser list changes.
pub fn spawn_detector(
    detected: DetectedBrowsersState,
    slots: BrowserSlotsMap,
    ext_store: ExtensionInstalledState,
    reconnecting: ReconnectingBrowsersState,
    ws_connections: WsConnectionMap,
    app: AppHandle,
) {
    std::thread::Builder::new()
        .name("browser-detector".into())
        .spawn(move || {
            // Emit once immediately so the frontend has data right away.
            let initial = build_detected_browsers();
            {
                let mut lock = detected.lock().unwrap_or_else(|e| e.into_inner());
                *lock = initial;
            }
            emit_browsers_to_ui(
                &app,
                &detected,
                &slots,
                &ext_store,
                &reconnecting,
                &ws_connections,
            );

            loop {
                std::thread::sleep(Duration::from_secs(2));
                let fresh = build_detected_browsers();
                let changed = {
                    let mut lock =
                        detected.lock().unwrap_or_else(|e| e.into_inner());
                    if *lock != fresh {
                        *lock = fresh;
                        true
                    } else {
                        false
                    }
                };
                if changed {
                    emit_browsers_to_ui(
                        &app,
                        &detected,
                        &slots,
                        &ext_store,
                        &reconnecting,
                        &ws_connections,
                    );
                }
            }
        })
        .expect("spawn browser-detector");
}
