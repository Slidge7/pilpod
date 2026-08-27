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

// NOTE: the floating widget has no stub here. `crate::widget` is
// platform-neutral (Tauri window APIs + integer geometry), so the real
// commands are registered on every platform.

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

#[tauri::command]
pub fn dev_get_full_state() -> Result<serde_json::Value, String> {
    Err("dev_get_full_state is Windows-only".into())
}

#[tauri::command]
pub fn dev_kill_ws(_browser_id: String) -> bool {
    false
}

#[tauri::command]
pub fn dev_clear_ext_installed(_os_browser_id: String) -> bool {
    false
}

#[tauri::command]
pub fn dev_clear_icon_cache() {}

#[tauri::command]
pub fn dev_inject_stale_slot(_os_browser_id: String) -> String {
    String::new()
}

#[tauri::command]
pub fn dev_gc_slots_now() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
pub fn dev_simulate_resume() -> usize {
    0
}

// ---- Vault smart-open stub (focus/launch is Windows-only) ----

#[tauri::command]
pub fn vault_open_entry(_url: String, _normalized_url: String) -> Result<String, String> {
    Err("Opening saved entries requires Windows".into())
}

// ---- Playlist player stubs (rides the Windows-only browser bridge) ----

const PLAYER_WIN_ONLY: &str = "Playlist playback requires Windows";

#[tauri::command]
pub fn player_get_state() -> serde_json::Value {
    serde_json::json!({
        "active": false,
        "status": "idle",
        "target": "browser",
        "trackNumber": 0,
        "totalTracks": 0,
        "repeat": "off",
        "shuffle": false,
        "autoPlay": true,
    })
}

#[tauri::command]
pub fn player_start(
    _playlist_id: String,
    _target: Option<String>,
    _browser_id: Option<String>,
    _shuffle: Option<bool>,
    _repeat: Option<String>,
    _auto_play: Option<bool>,
) -> Result<(), String> {
    Err(PLAYER_WIN_ONLY.into())
}

#[tauri::command]
pub fn player_stop(_close_tab: bool) -> Result<(), String> {
    Err(PLAYER_WIN_ONLY.into())
}

#[tauri::command]
pub fn player_next() -> Result<(), String> {
    Err(PLAYER_WIN_ONLY.into())
}

#[tauri::command]
pub fn player_prev() -> Result<(), String> {
    Err(PLAYER_WIN_ONLY.into())
}

#[tauri::command]
pub fn player_play_item(_item_id: String) -> Result<(), String> {
    Err(PLAYER_WIN_ONLY.into())
}

#[tauri::command]
pub fn player_set_modes(
    _repeat: Option<String>,
    _shuffle: Option<bool>,
    _auto_play: Option<bool>,
) -> Result<(), String> {
    Err(PLAYER_WIN_ONLY.into())
}

#[tauri::command]
pub fn inapp_drag_window() {}

#[tauri::command]
pub fn inapp_stage_get() -> serde_json::Value {
    serde_json::json!({ "kind": "idle", "volume": 100.0 })
}

#[tauri::command]
pub fn inapp_stage_report(_report: serde_json::Value) {}

#[tauri::command]
pub fn inapp_stage_ended() {}

#[tauri::command]
pub fn inapp_minimize_window() {}

#[tauri::command]
pub fn inapp_get_media() -> serde_json::Value {
    serde_json::json!({
        "active": false,
        "loading": false,
        "url": "",
        "title": "",
        "artist": "",
        "artworkUrl": "",
        "playbackState": "none",
        "duration": 0.0,
        "currentTime": 0.0,
        "volume": 100.0,
        "muted": false,
        "canSeek": false,
    })
}

// ── Extension setup ─────────────────────────────────────────────────────────
//
// The real `extension_setup::commands` module is `#[cfg(windows)]` — it needs
// the Win32 browser detector. These stubs exist so the frontend's invokes
// resolve on other platforms instead of failing with "command not found".
//
// The reported state is deliberately quiet: nothing needs attention and the
// onboarding gate counts as dismissed, because on a platform with no browser
// detection there is no setup for the user to complete.

#[tauri::command]
pub fn extension_setup_overview() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "storeUrl": "",
        "browsers": [],
        "onboardingDismissed": true,
        "needsAttention": false,
        "anyActive": false,
    }))
}

#[tauri::command]
pub fn extension_setup_gate_state() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "onboardingDismissed": true,
        "needsAttention": false,
        "anyActive": false,
        "attentionCount": 0,
    }))
}

#[tauri::command]
pub fn extension_setup_open_listing(_browser_id: String) -> Result<String, String> {
    Err("PilPod requires Windows".into())
}

#[tauri::command]
pub fn extension_setup_open_extensions_page(_browser_id: String) -> Result<String, String> {
    Err("PilPod requires Windows".into())
}

#[tauri::command]
pub fn extension_setup_skip(_browser_id: String) -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub fn extension_setup_cancel(_browser_id: String) -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub fn extension_setup_set_dismissed(_dismissed: bool) -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub fn extension_setup_reset(_browser_id: String) -> Result<bool, String> {
    Ok(false)
}
