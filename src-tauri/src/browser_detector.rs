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
/// **Design principles (Phase 2a):**
///
/// - `extension_installed` — persisted flag; never flips off on missed heartbeats.
/// - `extension_connected` — live freshness flag (last POST < 3 s ago).
/// - **Cached tabs are always shown** for OS-detected browsers that have a slot,
///   regardless of slot freshness.  Tabs are only replaced when a newer POST arrives.
/// - `last_sync_secs` — seconds since last POST, so the UI can render
///   "Offline · cached 2 min ago" without clearing the list.
/// - For extension-only browsers (not in OS registry), the row is only added while
///   freshly connected; they do not have a stable OS identity to fall back on.
pub fn merge_detected_and_slots(
    detected: &[DetectedBrowserInfo],
    slots: &HashMap<String, BrowserSlot>,
    ext_store: &ExtensionInstalledStore,
    reconnecting: &HashSet<String>,
) -> Vec<DetectedBrowser> {
    let slot_active_cutoff = Duration::from_secs(3);
    let now = std::time::Instant::now();

    // Start with one entry per OS-detected browser (always visible).
    let mut result: Vec<DetectedBrowser> = detected
        .iter()
        .map(|d| DetectedBrowser {
            id: d.id.clone(),
            display_name: d.display_name.clone(),
            running: d.running,
            extension_installed: ext_store.is_installed(&d.id),
            extension_connected: false,
            tab_count: 0,
            tabs: Vec::new(),
            last_sync_secs: None,
            extension_reconnecting: false,
        })
        .collect();

    let mut seen_ids: HashSet<String> =
        detected.iter().map(|d| d.id.clone()).collect();

    for slot in slots.values() {
        let is_fresh = now.duration_since(slot.last_seen) < slot_active_cutoff;
        let slot_id = browser_name_to_id(&slot.browser_name);
        let slot_age_secs = now.duration_since(slot.last_seen).as_secs();
        let is_reconnecting = reconnecting.contains(&slot.browser_id);

        if let Some(entry) = result.iter_mut().find(|b| b.id == slot_id) {
            if is_fresh {
                entry.extension_connected = true;
            }
            if is_reconnecting {
                entry.extension_reconnecting = true;
            }

            // Always attach cached tabs, regardless of freshness.  If multiple
            // slots resolve to the same OS browser (rare), keep the most recent.
            let is_newer = entry
                .last_sync_secs
                .map_or(true, |existing| slot_age_secs < existing);

            if is_newer {
                entry.tabs = slot.tabs.clone();
                entry.tab_count = slot.tabs.len() as u32;
                entry.last_sync_secs = Some(slot_age_secs);
            }
        } else if !seen_ids.contains(&slot_id) && is_fresh {
            // Extension-only browser (not in OS registry scan) — visible while connected.
            seen_ids.insert(slot_id.clone());
            result.push(DetectedBrowser {
                id: slot_id.clone(),
                display_name: slot.browser_name.clone(),
                running: true,
                extension_installed: ext_store.is_installed(&slot_id),
                extension_connected: true,
                tab_count: slot.tabs.len() as u32,
                tabs: slot.tabs.clone(),
                last_sync_secs: Some(slot_age_secs),
                extension_reconnecting: is_reconnecting,
            });
        }
    }

    // Browsers with the companion extension first; uninstalled ones at the bottom.
    // Partition preserves KNOWN_BROWSERS order within each group.
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
    let cutoff = Duration::from_secs(3);
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
) {
    let detected_list = detected
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let slots_map = slots.lock().unwrap_or_else(|e| e.into_inner());
    let store = ext_store.lock().unwrap_or_else(|e| e.into_inner());
    let reconnecting_set = reconnecting.lock().unwrap_or_else(|e| e.into_inner());

    let browsers = merge_detected_and_slots(
        &detected_list,
        &*slots_map,
        &*store,
        &*reconnecting_set,
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
) {
    emit_browsers_to_ui(app, detected, slots, ext_store, reconnecting);
}

// ── Background thread ────────────────────────────────────────────────────────

/// Spawn a background thread that polls for OS browser changes every 2 seconds.
/// Emits `"browsers://update"` whenever the installed/running browser list changes.
pub fn spawn_detector(
    detected: DetectedBrowsersState,
    slots: BrowserSlotsMap,
    ext_store: ExtensionInstalledState,
    reconnecting: ReconnectingBrowsersState,
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
            emit_browsers_to_ui(&app, &detected, &slots, &ext_store, &reconnecting);

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
                    emit_browsers_to_ui(&app, &detected, &slots, &ext_store, &reconnecting);
                }
            }
        })
        .expect("spawn browser-detector");
}
