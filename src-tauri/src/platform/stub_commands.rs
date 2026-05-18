use crate::gsmtc::dto::{DetectedBrowser, GsmtcSnapshot};

#[tauri::command]
pub fn gsmtc_refresh() -> Result<GsmtcSnapshot, String> {
    Err("PilPod requires Windows".into())
}

#[tauri::command]
pub fn gsmtc_toggle_play_pause(_session_index: u32) -> Result<(), String> {
    Err("PilPod requires Windows".into())
}

#[tauri::command]
pub fn gsmtc_skip_next(_session_index: u32) -> Result<(), String> {
    Err("PilPod requires Windows".into())
}

#[tauri::command]
pub fn gsmtc_skip_previous(_session_index: u32) -> Result<(), String> {
    Err("PilPod requires Windows".into())
}

#[tauri::command]
pub fn mixer_set_volume(_instance_id: String, _volume: f32) -> Result<(), String> {
    Err("PilPod requires Windows".into())
}

#[tauri::command]
pub fn browser_media_control(
    _browser_id: String,
    _tab_id: i32,
    _action: String,
    _tab_title_for_focus: Option<String>,
    _browser_window_hint: Option<String>,
) -> Result<(), String> {
    Err("PilPod requires Windows".into())
}

#[tauri::command]
pub fn toggle_widget_mode(_is_mini: bool) -> Result<(), String> {
    Err("PilPod requires Windows".into())
}

#[tauri::command]
pub fn get_browsers() -> Vec<DetectedBrowser> {
    Vec::new()
}

#[tauri::command]
pub fn refresh_browser_connection(_browser_id: String) {}

#[tauri::command]
pub fn request_browser_sync() {}
