use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};

use crate::audio_mixer::set_session_volume_by_instance_id;
use crate::browser_bridge::SyncRequestedFlag;
use crate::browser_detector::{
    browser_name_to_id, emit_browsers_to_ui, merge_detected_and_slots,
    DetectedBrowsersState, ExtensionInstalledState,
};
use crate::browser_tabs::BrowserSlotsMap;
use crate::gsmtc::dto::DetectedBrowser;

use super::dto::GsmtcSnapshot;
use super::state::{emit_fast_to_ui, GsmtcState};

// All media-control commands identify sessions by their stable AUMID
// (sourceAppUserModelId) rather than a volatile list index that can shift
// whenever any media app opens or closes.

// NOTE: All commands are `async fn` on purpose. In Tauri 2 a plain `fn`
// command runs on the **main thread**, and the WinRT `.get()` calls below
// (and thumbnail reads inside `snapshot()`) block. Blocking the STA UI
// thread shows the window as "Not Responding". `async fn` dispatches the
// command onto Tauri's async runtime instead.

fn run_blocking<F, R>(f: F) -> tauri::async_runtime::JoinHandle<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
}

#[tauri::command]
pub async fn gsmtc_refresh(state: State<'_, Arc<GsmtcState>>) -> Result<GsmtcSnapshot, String> {
    let state = Arc::clone(&state);
    run_blocking(move || state.snapshot())
        .await
        .map_err(|e| format!("join error: {e}"))?
}

#[tauri::command]
pub async fn gsmtc_toggle_play_pause(
    state: State<'_, Arc<GsmtcState>>,
    aumid: String,
) -> Result<(), String> {
    let state = Arc::clone(&state);
    run_blocking(move || {
        let session = state.session_by_aumid(&aumid)?;
        session
            .TryTogglePlayPauseAsync()
            .map_err(|e| e.message().to_string())?
            .get()
            .map_err(|e| e.message().to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

#[tauri::command]
pub async fn gsmtc_skip_next(
    state: State<'_, Arc<GsmtcState>>,
    aumid: String,
) -> Result<(), String> {
    let state = Arc::clone(&state);
    run_blocking(move || {
        let session = state.session_by_aumid(&aumid)?;
        session
            .TrySkipNextAsync()
            .map_err(|e| e.message().to_string())?
            .get()
            .map_err(|e| e.message().to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

#[tauri::command]
pub async fn gsmtc_skip_previous(
    state: State<'_, Arc<GsmtcState>>,
    aumid: String,
) -> Result<(), String> {
    let state = Arc::clone(&state);
    run_blocking(move || {
        let session = state.session_by_aumid(&aumid)?;
        session
            .TrySkipPreviousAsync()
            .map_err(|e| e.message().to_string())?
            .get()
            .map_err(|e| e.message().to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

/// Return the current merged browser list (OS-detected + extension slots) synchronously.
/// The frontend also listens to `"browsers://update"` for live updates; this command
/// provides the initial snapshot on mount.
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
/// removing it, so the **cached tab list is preserved**.  If the extension is
/// running, it will POST within ~250 ms and restore `extension_connected`.
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
    // Tell the bridge: next POST response should carry syncNow=true.
    sync_flag.store(true, Ordering::Relaxed);
    // Immediately push the current cache to the frontend (no blank flash).
    emit_browsers_to_ui(&app, &detected, &slots, &ext_store);
}

#[tauri::command]
pub async fn mixer_set_volume(
    app: AppHandle,
    state: State<'_, Arc<GsmtcState>>,
    instance_id: String,
    volume: f32,
) -> Result<(), String> {
    let state = Arc::clone(&state);
    run_blocking(move || {
        set_session_volume_by_instance_id(&instance_id, volume)?;
        emit_fast_to_ui(&app, &state);
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}
