//! Commands for the player window's own UI.
//!
//! Deliberately app commands rather than core-plugin APIs: app commands are
//! reachable from every local webview without a capability, so the player UI
//! keeps working no matter how its capability resolves. Everything else it
//! needs already exists — transport and modes through `player_*`, playback
//! through `browser_media_control` (routed on the synthetic `pilpod-inapp`
//! browser id), the track list through `vault_*`.

use tauri::AppHandle;

use super::dto::{InAppMediaDto, StageDto, StageReport};

#[tauri::command]
pub fn inapp_get_media() -> InAppMediaDto {
    super::media_snapshot()
}

/// What PilPod's own stage page should render (hydration for `StageView`).
#[tauri::command]
pub fn inapp_stage_get() -> StageDto {
    super::stage_snapshot()
}

/// A media snapshot from the stage page.
#[tauri::command]
pub fn inapp_stage_report(app: AppHandle, report: StageReport) {
    super::on_stage_report(&app, report);
}

/// The stage page's track played to its end.
#[tauri::command]
pub fn inapp_stage_ended(app: AppHandle) {
    super::on_stage_ended(&app);
}

/// Start an OS window drag — the player window has no decorations.
#[tauri::command]
pub fn inapp_drag_window(app: AppHandle) {
    super::window::start_drag(&app);
}

/// Minimise the player window.
#[tauri::command]
pub fn inapp_minimize_window(app: AppHandle) {
    super::window::minimize(&app);
}
