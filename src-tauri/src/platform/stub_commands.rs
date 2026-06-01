use crate::browser_dto::BrowsersUpdatePayload;

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
pub fn get_browsers() -> BrowsersUpdatePayload {
    BrowsersUpdatePayload {
        browsers: Vec::new(),
        browser_audio: std::collections::HashMap::new(),
    }
}

#[tauri::command]
pub fn refresh_browser_connection(_browser_id: String) {}

#[tauri::command]
pub fn request_browser_sync() {}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevOsBrowserRowStub {
    pub id: String,
    pub display_name: String,
    pub installed: bool,
    pub running: bool,
    pub process_state: String,
    pub process_count: u32,
    pub extension_installed_os: bool,
    pub icon_url: Option<String>,
}

#[tauri::command]
pub fn open_dev_lab_window() -> Result<(), String> {
    Err("PilPod requires Windows".into())
}

#[tauri::command]
pub fn dev_scan_os_browsers() -> Vec<DevOsBrowserRowStub> {
    Vec::new()
}

#[tauri::command]
pub async fn dev_wake_and_sync_browser(os_browser_id: String) -> Result<serde_json::Value, String> {
    Err(format!(
        "dev_wake_and_sync_browser is Windows-only (requested: {os_browser_id})"
    ))
}
