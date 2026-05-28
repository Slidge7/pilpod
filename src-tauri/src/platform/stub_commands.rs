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

// ─── Downloader stubs (non-Windows) ──────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct BinaryStatusStub {
    pub ytdlp_present: bool,
    pub ffmpeg_present: bool,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_version: Option<String>,
    pub ok: bool,
}

#[derive(serde::Serialize)]
pub struct FormatPresetStub {
    pub label: String,
    pub format_id: String,
    pub audio_only: bool,
    pub audio_format: Option<String>,
}

#[derive(serde::Serialize)]
pub struct VideoInfoWithPresetsStub {
    pub title: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub webpage_url: String,
    pub presets: Vec<FormatPresetStub>,
}

#[derive(serde::Serialize)]
pub struct DownloadTaskStub;

#[tauri::command]
pub async fn dl_fetch_info(_url: String) -> Result<VideoInfoWithPresetsStub, String> {
    Err("Windows only".into())
}

#[tauri::command]
pub async fn dl_start(
    _url: String,
    _format_id: String,
    _audio_only: bool,
    _audio_format: Option<String>,
) -> Result<String, String> {
    Err("Windows only".into())
}

#[tauri::command]
pub fn dl_cancel(_task_id: String) -> Result<(), String> {
    Err("Windows only".into())
}

#[tauri::command]
pub fn dl_get_queue() -> Vec<DownloadTaskStub> {
    Vec::new()
}

#[tauri::command]
pub fn dl_clear_done() {}

#[tauri::command]
pub fn dl_get_output_dir() -> String {
    String::new()
}

#[tauri::command]
pub fn dl_set_output_dir(_path: String) -> Result<(), String> {
    Err("Windows only".into())
}

#[tauri::command]
pub fn dl_open_output_dir() -> Result<(), String> {
    Err("Windows only".into())
}

#[tauri::command]
pub async fn dl_check_binaries() -> BinaryStatusStub {
    BinaryStatusStub {
        ytdlp_present: false,
        ffmpeg_present: false,
        ytdlp_version: None,
        ffmpeg_version: None,
        ok: false,
    }
}

#[tauri::command]
pub async fn dl_update_ytdlp() -> Result<(), String> {
    Err("Windows only".into())
}
