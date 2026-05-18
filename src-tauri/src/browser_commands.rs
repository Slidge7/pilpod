//! Tauri commands for the browser detection and tab control subsystem.
//!
//! These commands are intentionally separate from the GSMTC module — they
//! operate on OS-detected browsers and the companion extension bridge, not on
//! Windows Media Sessions.

use std::time::{Duration, Instant};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};

use crate::browser_bridge::SyncRequestedFlag;
use crate::browser_detector::{
    browser_name_to_id, emit_browsers_to_ui, merge_detected_and_slots,
    DetectedBrowsersState, ExtensionInstalledState,
};
use crate::browser_tabs::BrowserSlotsMap;
use crate::gsmtc::dto::DetectedBrowser;

/// Return the current merged browser list (OS-detected + extension slots).
///
/// The frontend also subscribes to `"browsers://update"` for live pushes; this
/// command provides the initial snapshot on mount.
#[tauri::command]
pub fn get_browsers(
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
) -> Vec<DetectedBrowser> {
    let detected_list = detected
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let slots_map = slots.lock().unwrap_or_else(|e| e.into_inner());
    let store = ext_store.lock().unwrap_or_else(|e| e.into_inner());
    merge_detected_and_slots(&detected_list, &*slots_map, &*store)
}

/// Re-probe the extension connection for a single browser.
///
/// Marks the slot as stale (forces `extension_connected` to `false`) without
/// removing it, so the cached tab list is preserved.  If the extension is
/// running it will POST within ~250 ms and restore `extension_connected`.
///
/// The persisted `extension_installed` flag is intentionally left unchanged.
#[tauri::command]
pub fn refresh_browser_connection(
    browser_id: String,
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    app: AppHandle,
) {
    if let Ok(mut map) = slots.lock() {
        for slot in map.values_mut() {
            if browser_name_to_id(&slot.browser_name) == browser_id {
                // Push last_seen back 60 s so extension_connected flips to false.
                // Cached tabs are kept so the UI does not go blank.
                slot.last_seen = Instant::now() - Duration::from_secs(60);
            }
        }
    }
    emit_browsers_to_ui(&app, &detected, &slots, &ext_store);
}

/// Emit the current cached browser/tab list to the frontend immediately, and
/// signal the bridge to request a fresh push from the extension on its next POST.
///
/// Called on PilPod window focus so the UI gets up-to-date tabs without waiting
/// for the 2-second OS detector tick or the next 250 ms extension heartbeat.
#[tauri::command]
pub fn request_browser_sync(
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    sync_flag: State<'_, SyncRequestedFlag>,
    app: AppHandle,
) {
    sync_flag.store(true, Ordering::Relaxed);
    emit_browsers_to_ui(&app, &detected, &slots, &ext_store);
}
