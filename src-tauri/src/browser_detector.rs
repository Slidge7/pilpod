//! OS-level browser detection: Windows registry scan + running process enumeration.
//!
//! Produces a `Vec<DetectedBrowserInfo>` of installed and/or running browsers,
//! entirely independent of the companion extension.  The extension's role is narrowed
//! to tab reporting: the HTTP bridge marks `extension_installed = true` on a
//! `DetectedBrowser` when it receives a POST from that browser.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

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

/// Merge OS-detected browsers with active extension slots into the frontend view.
///
/// - Browsers detected by the OS but with no recent extension POST →
///   `extension_installed: false`, `tabs: []`
/// - Browsers detected only via extension (not in the OS scan) →
///   still shown (treated as running, e.g. a browser not in the known list)
pub fn merge_detected_and_slots(
    detected: &[DetectedBrowserInfo],
    slots: &HashMap<String, BrowserSlot>,
) -> Vec<DetectedBrowser> {
    let slot_active_cutoff = Duration::from_secs(3);
    let now = std::time::Instant::now();

    // Start with one entry per OS-detected browser.
    let mut result: Vec<DetectedBrowser> = detected
        .iter()
        .map(|d| DetectedBrowser {
            id: d.id.clone(),
            display_name: d.display_name.clone(),
            running: d.running,
            extension_installed: false,
            tab_count: 0,
            tabs: Vec::new(),
        })
        .collect();

    let mut seen_ids: HashSet<String> =
        detected.iter().map(|d| d.id.clone()).collect();

    // Overlay extension slot data onto matching detected entries.
    for slot in slots.values() {
        if now.duration_since(slot.last_seen) >= slot_active_cutoff {
            continue; // stale slot — extension disconnected or browser closed
        }

        let slot_id = browser_name_to_id(&slot.browser_name);

        if let Some(entry) = result.iter_mut().find(|b| b.id == slot_id) {
            entry.extension_installed = true;
            entry.tabs = slot.tabs.clone();
            entry.tab_count = slot.tabs.len() as u32;
        } else if !seen_ids.contains(&slot_id) {
            // Browser reported by extension but not found in OS scan.
            seen_ids.insert(slot_id.clone());
            result.push(DetectedBrowser {
                id: slot_id,
                display_name: slot.browser_name.clone(),
                running: true,
                extension_installed: true,
                tab_count: slot.tabs.len() as u32,
                tabs: slot.tabs.clone(),
            });
        }
    }

    result
}

// ── Emission ─────────────────────────────────────────────────────────────────

/// Build and emit the merged browser list to the frontend on `"browsers://update"`.
pub fn emit_browsers_to_ui(
    app: &AppHandle,
    detected: &DetectedBrowsersState,
    slots: &BrowserSlotsMap,
) {
    let detected_list = detected
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let slots_map = slots.lock().unwrap_or_else(|e| e.into_inner());

    let browsers = merge_detected_and_slots(&detected_list, &*slots_map);

    if let Err(e) = app.emit(BROWSERS_UPDATE_EVENT, &browsers) {
        eprintln!("[browser-detector] emit failed: {e}");
    }
}

// ── Background thread ────────────────────────────────────────────────────────

/// Spawn a background thread that polls for OS browser changes every 2 seconds.
/// Emits `"browsers://update"` whenever the installed/running browser list changes.
pub fn spawn_detector(
    detected: DetectedBrowsersState,
    slots: BrowserSlotsMap,
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
            emit_browsers_to_ui(&app, &detected, &slots);

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
                    emit_browsers_to_ui(&app, &detected, &slots);
                }
            }
        })
        .expect("spawn browser-detector");
}
