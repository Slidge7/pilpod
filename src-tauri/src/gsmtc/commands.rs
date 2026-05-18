use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::audio_mixer::set_session_volume_by_instance_id;
use crate::browser_detector::{merge_detected_and_slots, DetectedBrowsersState};
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
) -> Vec<DetectedBrowser> {
    let detected_list = detected
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let slots_map = slots.lock().unwrap_or_else(|e| e.into_inner());
    merge_detected_and_slots(&detected_list, &*slots_map)
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
