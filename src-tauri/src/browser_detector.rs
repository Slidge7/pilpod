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

use crate::browser_catalog::{self, CATALOG};
use crate::browser_tabs::{BrowserSlot, BrowserSlotsMap};
use crate::browser_bridge::connections::{ws_connected_ids, WsConnectionMap};
use crate::browser_bridge::CONNECTED_WINDOW_SECS;
use crate::browser_dto::{BrowsersUpdatePayload, DetectedBrowser, DetectedBrowserInfo};

/// Event name emitted to the frontend when the browser list changes.
pub const BROWSERS_UPDATE_EVENT: &str = "browsers://update";

/// Slots not seen for this long are garbage-collected (Phase 5). Covers
/// extension reinstalls (new UUID — the old one never returns) and deleted
/// profiles. Long enough that sleep/resume and Kill-WS reconnects survive.
pub const SLOT_GC_SECS: u64 = 900;

/// A browser stays "running" this long after its process disappears (Phase 5).
/// Survives the brief exe swap during a browser self-update without the UI
/// flapping to "not running".
pub const RUNNING_GRACE_SECS: u64 = 10;

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

    /// Dev-lab: forget the persisted extension-installed flag for one browser.
    /// Returns `true` if the flag was present (and the file was rewritten).
    pub fn clear(&mut self, browser_id: &str) -> bool {
        if self.installed.remove(browser_id).is_none() {
            return false;
        }
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

/// Map a browser name reported by the extension to a stable catalog id.
pub fn browser_name_to_id(name: &str) -> String {
    browser_catalog::browser_name_to_id(name)
}

// ── OS scanning ──────────────────────────────────────────────────────────────

/// Enumerate running catalog browsers via toolhelp + full image path for disambiguation.
pub(crate) fn scan_running_browsers() -> HashSet<String> {
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
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                let full_path = browser_catalog::image_path_for_pid(entry.th32ProcessID);
                if let Some(id) =
                    browser_catalog::match_running_process(&name, full_path.as_deref())
                {
                    running.insert(id.to_string());
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

fn scan_installed_from_hive(hive: winreg::HKEY) -> HashSet<String> {
    let mut installed = HashSet::new();
    let root = winreg::RegKey::predef(hive);
    if let Ok(key) = root.open_subkey("SOFTWARE\\Clients\\StartMenuInternet") {
        for name_result in key.enum_keys() {
            if let Ok(name) = name_result {
                if let Some(entry) = browser_catalog::match_registry_key(&name) {
                    installed.insert(entry.id.to_string());
                }
            }
        }
    }
    installed
}

/// Read installed browsers from HKLM and HKCU `StartMenuInternet`, plus MSIX/App Paths fallbacks.
pub(crate) fn scan_installed_browsers() -> HashSet<String> {
    let mut installed = scan_installed_from_hive(winreg::enums::HKEY_LOCAL_MACHINE);
    installed.extend(scan_installed_from_hive(winreg::enums::HKEY_CURRENT_USER));
    installed.extend(browser_catalog::scan_supplemental_installed());
    installed
}

/// Build the current detected-browser list from both registry and running processes.
pub fn build_detected_browsers() -> Vec<DetectedBrowserInfo> {
    let installed = scan_installed_browsers();
    let running = scan_running_browsers();

    CATALOG
        .iter()
        .filter(|e| installed.contains(e.id) || running.contains(e.id))
        .map(|e| DetectedBrowserInfo {
            id: e.id.to_string(),
            display_name: e.display_name.to_string(),
            running: running.contains(e.id),
        })
        .collect()
}

// ── Hardening (Phase 5) ──────────────────────────────────────────────────────

/// Remove slots whose `last_seen` is older than `ttl`. Returns removed UUIDs.
pub fn gc_stale_slots(
    slots: &mut HashMap<String, BrowserSlot>,
    now: std::time::Instant,
    ttl: Duration,
) -> Vec<String> {
    let stale: Vec<String> = slots
        .iter()
        .filter(|(_, s)| now.saturating_duration_since(s.last_seen) > ttl)
        .map(|(id, _)| id.clone())
        .collect();
    for id in &stale {
        slots.remove(id);
    }
    stale
}

/// Keep browsers "running" for `grace` after their process disappears, so the
/// exe swap during a browser self-update doesn't flap the UI.
///
/// `last_running` is the detector thread's memory of when each browser was
/// last seen with a live process.
pub fn debounce_running(
    detected: &mut [DetectedBrowserInfo],
    last_running: &mut HashMap<String, std::time::Instant>,
    now: std::time::Instant,
    grace: Duration,
) {
    for info in detected.iter_mut() {
        if info.running {
            last_running.insert(info.id.clone(), now);
        } else if let Some(seen) = last_running.get(&info.id) {
            if now.saturating_duration_since(*seen) <= grace {
                info.running = true; // within grace — hold steady
            } else {
                last_running.remove(&info.id);
            }
        }
    }
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
        // Phase 3: PID-verified binding wins over the self-reported name.
        let os_id = slot.effective_os_id();
        *slots_per_os.entry(os_id).or_insert(0) += 1;
    }

    let mut result: Vec<DetectedBrowser> = Vec::new();
    let mut os_ids_with_slots: HashSet<String> = HashSet::new();

    // Pass B: one row per extension profile slot.
    for slot in slots.values() {
        let os_id = slot.effective_os_id();
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

        // Phase 4: stable, human-friendly numbering persisted across restarts.
        let profile_label = if slots_per_os.get(&os_id).copied().unwrap_or(0) > 1 {
            let n = crate::browser_profile_order::profile_number(&os_id, &slot.browser_id);
            Some(format!("{base_display} · Profile {n}"))
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
            windows: crate::browser_dto::windows_for_tabs(&slot.tabs),
            tabs: slot.tabs.clone(),
            last_sync_secs: Some(slot_age_secs),
            extension_reconnecting,
            icon_url: crate::browser_icon::data_url_for_browser(&os_id),
        });
    }

    // Deterministic row order (HashMap iteration is random): OS id, then
    // profile number, then UUID as tiebreaker.
    result.sort_by(|a, b| {
        (
            a.os_browser_id.as_str(),
            a.profile_label.as_deref().unwrap_or(""),
            a.id.as_str(),
        )
            .cmp(&(
                b.os_browser_id.as_str(),
                b.profile_label.as_deref().unwrap_or(""),
                b.id.as_str(),
            ))
    });

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
            windows: Vec::new(),
            last_sync_secs: None,
            extension_reconnecting: false,
            icon_url: crate::browser_icon::data_url_for_browser(&d.id),
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
///
/// Currently unreferenced — kept for the GSMTC dedup work (media pipeline plan).
#[allow(dead_code)]
pub fn active_extension_browser_ids(slots: &HashMap<String, BrowserSlot>) -> HashSet<String> {
    let cutoff = Duration::from_secs(CONNECTED_WINDOW_SECS);
    let now = std::time::Instant::now();
    slots
        .values()
        .filter(|slot| now.duration_since(slot.last_seen) < cutoff)
        .map(|slot| slot.effective_os_id())
        .collect()
}

// ── Emission ─────────────────────────────────────────────────────────────────

/// Build the merged browser list plus per-profile WASAPI audio map.
pub fn build_browsers_payload(
    detected: &DetectedBrowsersState,
    slots: &BrowserSlotsMap,
    ext_store: &ExtensionInstalledState,
    reconnecting: &ReconnectingBrowsersState,
    ws_connections: &WsConnectionMap,
) -> BrowsersUpdatePayload {
    let detected_list = detected
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let slots_map = slots.lock().unwrap_or_else(|e| e.into_inner());
    let store = ext_store.lock().unwrap_or_else(|e| e.into_inner());
    let reconnecting_set = reconnecting.lock().unwrap_or_else(|e| e.into_inner());
    let ws_connected = ws_connected_ids(ws_connections);

    let mut browsers = merge_detected_and_slots(
        &detected_list,
        &*slots_map,
        &*store,
        &*reconnecting_set,
        &ws_connected,
    );

    // The in-app player is a one-tab media source of its own. Appending it here
    // (and nowhere else) is what makes the whole dashboard control it without
    // knowing it is not a browser. No session ⇒ nothing appended.
    if let Some(row) = crate::inapp_player::detected_browser_row() {
        browsers.push(row);
    }

    #[cfg(windows)]
    let browser_audio = crate::browser_audio::browser_audio_for_slots(&slots_map);
    #[cfg(not(windows))]
    let browser_audio = std::collections::HashMap::new();

    BrowsersUpdatePayload {
        browsers,
        browser_audio,
    }
}

/// Build and emit the merged browser list to the frontend on `"browsers://update"`.
pub fn emit_browsers_to_ui(
    app: &AppHandle,
    detected: &DetectedBrowsersState,
    slots: &BrowserSlotsMap,
    ext_store: &ExtensionInstalledState,
    reconnecting: &ReconnectingBrowsersState,
    ws_connections: &WsConnectionMap,
) {
    let payload = build_browsers_payload(
        detected,
        slots,
        ext_store,
        reconnecting,
        ws_connections,
    );

    if let Err(e) = app.emit(BROWSERS_UPDATE_EVENT, &payload) {
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

            // Phase 5: per-browser memory of the last time a process was seen,
            // used to hold "running" through brief exe swaps (browser updates).
            let mut last_running: HashMap<String, std::time::Instant> = HashMap::new();

            loop {
                std::thread::sleep(Duration::from_secs(2));
                let now = std::time::Instant::now();

                let mut fresh = build_detected_browsers();
                debounce_running(
                    &mut fresh,
                    &mut last_running,
                    now,
                    Duration::from_secs(RUNNING_GRACE_SECS),
                );

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

                // Phase 5: drop slots that have been silent too long (extension
                // reinstall leaves a dead UUID; deleted profiles never return).
                let removed = {
                    let mut map = slots.lock().unwrap_or_else(|e| e.into_inner());
                    gc_stale_slots(&mut map, now, Duration::from_secs(SLOT_GC_SECS))
                };
                if !removed.is_empty() {
                    if let Ok(mut set) = reconnecting.lock() {
                        for id in &removed {
                            set.remove(id);
                        }
                    }
                    eprintln!("[browser-detector] gc: removed {} stale slot(s)", removed.len());
                }

                if changed || !removed.is_empty() {
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

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn slot(uuid: &str, name: &str, verified: Option<&str>) -> BrowserSlot {
        BrowserSlot {
            last_seen: Instant::now(),
            browser_id: uuid.to_string(),
            browser_name: name.to_string(),
            verified_os_id: verified.map(|s| s.to_string()),
            tabs: Vec::new(),
            content_hash: 0,
        }
    }

    fn detected(id: &str, name: &str, running: bool) -> DetectedBrowserInfo {
        DetectedBrowserInfo {
            id: id.to_string(),
            display_name: name.to_string(),
            running,
        }
    }

    fn merge(
        detected: Vec<DetectedBrowserInfo>,
        slots: Vec<BrowserSlot>,
    ) -> Vec<DetectedBrowser> {
        let map: HashMap<String, BrowserSlot> = slots
            .into_iter()
            .map(|s| (s.browser_id.clone(), s))
            .collect();
        merge_detected_and_slots(
            &detected,
            &map,
            &ExtensionInstalledStore::default(),
            &HashSet::new(),
            &HashSet::new(),
        )
    }

    #[test]
    fn verified_slot_binds_to_correct_os_row() {
        // Brave self-reports "Chrome" but the socket owner is brave.exe.
        let rows = merge(
            vec![
                detected("chrome", "Google Chrome", true),
                detected("brave", "Brave", true),
            ],
            vec![slot("uuid-1", "Chrome", Some("brave"))],
        );

        let brave_row = rows.iter().find(|r| r.os_browser_id == "brave").unwrap();
        assert_eq!(brave_row.id, "uuid-1"); // slot row, not placeholder
        assert_eq!(brave_row.display_name, "Brave");

        // Chrome keeps its own placeholder row — no cross-talk.
        let chrome_row = rows.iter().find(|r| r.os_browser_id == "chrome").unwrap();
        assert_eq!(chrome_row.id, "chrome");
        assert_eq!(chrome_row.tab_count, 0);
    }

    #[test]
    fn unverified_slot_falls_back_to_self_report() {
        let rows = merge(
            vec![detected("firefox", "Mozilla Firefox", true)],
            vec![slot("uuid-1", "Firefox", None)],
        );
        let row = rows.iter().find(|r| r.id == "uuid-1").unwrap();
        assert_eq!(row.os_browser_id, "firefox");
    }

    #[test]
    fn same_exe_forks_stay_separate_when_verified() {
        // Opera and Opera GX share opera.exe; PID verification disambiguates.
        let rows = merge(
            vec![
                detected("opera", "Opera", true),
                detected("operagx", "Opera GX", true),
            ],
            vec![
                slot("uuid-o", "Opera", Some("opera")),
                slot("uuid-gx", "Opera", Some("operagx")),
            ],
        );
        let opera = rows.iter().find(|r| r.id == "uuid-o").unwrap();
        let gx = rows.iter().find(|r| r.id == "uuid-gx").unwrap();
        assert_eq!(opera.os_browser_id, "opera");
        assert_eq!(gx.os_browser_id, "operagx");
        assert_eq!(opera.display_name, "Opera");
        assert_eq!(gx.display_name, "Opera GX");
        // Different OS ids → not merged into one profile group.
        assert!(opera.profile_label.is_none());
        assert!(gx.profile_label.is_none());
    }

    #[test]
    fn two_profiles_of_same_verified_browser_get_labels() {
        let rows = merge(
            vec![detected("chrome", "Google Chrome", true)],
            vec![
                slot("uuid-aaaa1111", "Chrome", Some("chrome")),
                slot("uuid-bbbb2222", "Chrome", Some("chrome")),
            ],
        );
        let chrome_rows: Vec<_> =
            rows.iter().filter(|r| r.os_browser_id == "chrome").collect();
        assert_eq!(chrome_rows.len(), 2);
        // Phase 4: labels are stable numbers, not UUID prefixes.
        for r in &chrome_rows {
            let label = r.profile_label.as_deref().unwrap();
            assert!(
                label.starts_with("Google Chrome · Profile "),
                "unexpected label {label:?}"
            );
        }
        // Distinct numbers per profile.
        assert_ne!(chrome_rows[0].profile_label, chrome_rows[1].profile_label);
    }

    #[test]
    fn gc_removes_only_stale_slots() {
        let ttl = Duration::from_secs(900);
        let now = Instant::now();
        let mut map: HashMap<String, BrowserSlot> = HashMap::new();

        let mut fresh = slot("uuid-fresh", "Chrome", None);
        fresh.last_seen = now - Duration::from_secs(10);
        let mut stale = slot("uuid-stale", "Chrome", None);
        stale.last_seen = now - Duration::from_secs(901);
        let mut edge = slot("uuid-edge", "Chrome", None);
        edge.last_seen = now - ttl; // exactly at ttl — kept (strictly greater removes)

        map.insert(fresh.browser_id.clone(), fresh);
        map.insert(stale.browser_id.clone(), stale);
        map.insert(edge.browser_id.clone(), edge);

        let removed = gc_stale_slots(&mut map, now, ttl);
        assert_eq!(removed, vec!["uuid-stale".to_string()]);
        assert!(map.contains_key("uuid-fresh"));
        assert!(map.contains_key("uuid-edge"));
        assert!(!map.contains_key("uuid-stale"));
    }

    #[test]
    fn gc_empty_map_is_noop() {
        let mut map: HashMap<String, BrowserSlot> = HashMap::new();
        assert!(gc_stale_slots(&mut map, Instant::now(), Duration::from_secs(900)).is_empty());
    }

    #[test]
    fn debounce_holds_running_within_grace() {
        let grace = Duration::from_secs(10);
        let mut last_running: HashMap<String, Instant> = HashMap::new();
        let t0 = Instant::now();

        // Tick 1: chrome running — remembered.
        let mut d = vec![detected("chrome", "Google Chrome", true)];
        debounce_running(&mut d, &mut last_running, t0, grace);
        assert!(d[0].running);

        // Tick 2 (+4s): process briefly gone (update swap) — held running.
        let mut d = vec![detected("chrome", "Google Chrome", false)];
        debounce_running(&mut d, &mut last_running, t0 + Duration::from_secs(4), grace);
        assert!(d[0].running, "should hold running within grace");

        // Tick 3 (+15s): still gone — grace expired, reported stopped.
        let mut d = vec![detected("chrome", "Google Chrome", false)];
        debounce_running(&mut d, &mut last_running, t0 + Duration::from_secs(15), grace);
        assert!(!d[0].running, "grace expired");
        assert!(!last_running.contains_key("chrome"), "memory purged");
    }

    #[test]
    fn debounce_never_marks_never_seen_browser_running() {
        let mut last_running: HashMap<String, Instant> = HashMap::new();
        let mut d = vec![detected("brave", "Brave", false)];
        debounce_running(&mut d, &mut last_running, Instant::now(), Duration::from_secs(10));
        assert!(!d[0].running);
    }

    #[test]
    fn verified_slot_for_undetected_browser_still_gets_row() {
        // Extension connects from a browser the registry scan missed (portable install).
        let rows = merge(vec![], vec![slot("uuid-1", "Chrome", Some("vivaldi"))]);
        let row = rows.iter().find(|r| r.id == "uuid-1").unwrap();
        assert_eq!(row.os_browser_id, "vivaldi");
        // No OS info: falls back to the reported name for display, assumed running.
        assert!(row.running);
    }
}
