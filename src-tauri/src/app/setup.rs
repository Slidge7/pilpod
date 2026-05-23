use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Payload emitted on `gsmtc://init-error` when GSMTC cannot start.
#[derive(Serialize, Clone)]
struct GsmtcInitError {
    message: String,
}

/// Taskbar / window icon.
pub fn apply_main_window_icon(handle: &AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        if let Err(e) = window.set_icon(tauri::include_image!("icons/icon.ico")) {
            eprintln!("[pilpod] window icon: {e}");
        }
    }
}

pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    #[cfg(windows)]
    apply_main_window_icon(&handle);

    // ── Shared state ─────────────────────────────────────────────────────────

    let browser_slots: crate::browser_tabs::BrowserSlotsMap =
        std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));

    let browser_commands: crate::browser_tabs::BrowserCommandsQueue =
        std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));

    let detected_browsers: crate::browser_detector::DetectedBrowsersState =
        std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));

    let ext_store: crate::browser_detector::ExtensionInstalledState =
        std::sync::Arc::new(std::sync::Mutex::new(
            crate::browser_detector::ExtensionInstalledStore::load(&handle),
        ));

    let reconnecting: crate::browser_detector::ReconnectingBrowsersState =
        crate::browser_detector::new_reconnecting_state();

    let ws_connections = crate::browser_bridge::new_ws_connection_map();

    let sync_flag: crate::browser_bridge::SyncRequestedFlag = std::sync::Arc::new(
        std::sync::atomic::AtomicBool::new(false),
    );

    let gsmtc_slot: std::sync::Arc<
        std::sync::Mutex<Option<std::sync::Arc<crate::gsmtc::GsmtcState>>>,
    > = std::sync::Arc::new(std::sync::Mutex::new(None));

    // ── Downloader ────────────────────────────────────────────────────────────
    let download_state = crate::downloader::init(&handle);
    let _ = app.manage(std::sync::Arc::clone(&download_state));

    // ── Manage state for Tauri commands ──────────────────────────────────────
    let _ = app.manage(std::sync::Arc::clone(&browser_commands));
    let _ = app.manage(std::sync::Arc::clone(&detected_browsers));
    let _ = app.manage(std::sync::Arc::clone(&browser_slots));
    let _ = app.manage(std::sync::Arc::clone(&ext_store));
    let _ = app.manage(std::sync::Arc::clone(&sync_flag));
    let _ = app.manage(std::sync::Arc::clone(&reconnecting));
    let _ = app.manage(std::sync::Arc::clone(&ws_connections));

    // ── Spawn HTTP + WebSocket bridge + power listener ───────────────────────
    crate::browser_bridge::spawn(
        std::sync::Arc::clone(&browser_slots),
        std::sync::Arc::clone(&browser_commands),
        handle.clone(),
        std::sync::Arc::clone(&gsmtc_slot),
        std::sync::Arc::clone(&detected_browsers),
        std::sync::Arc::clone(&ext_store),
        std::sync::Arc::clone(&reconnecting),
        std::sync::Arc::clone(&sync_flag),
        std::sync::Arc::clone(&ws_connections),
    );

    // ── Spawn OS browser detector ────────────────────────────────────────────
    crate::browser_detector::spawn_detector(
        std::sync::Arc::clone(&detected_browsers),
        std::sync::Arc::clone(&browser_slots),
        std::sync::Arc::clone(&ext_store),
        std::sync::Arc::clone(&reconnecting),
        ws_connections,
        handle.clone(),
    );

    // ── Spawn GSMTC init (must run off the STA UI thread) ───────────────────
    std::thread::Builder::new()
        .name("gsmtc-init".into())
        .spawn(move || {
            eprintln!("[gsmtc] init thread starting");
            match crate::gsmtc::GsmtcState::create(handle.clone(), browser_slots) {
                Ok(state) => {
                    eprintln!("[gsmtc] init ok, managing state");
                    if let Ok(mut slot) = gsmtc_slot.lock() {
                        *slot = Some(std::sync::Arc::clone(&state));
                    }
                    let _ = handle.manage(state);
                }
                Err(err) => {
                    eprintln!("[gsmtc] init failed: {err:?}");
                    let message = format!(
                        "Windows Media Controls could not start: {}. \
                         PilPod requires Windows 10 build 1809 (October 2018 Update) or later.",
                        err.message()
                    );
                    let _ = handle.emit(crate::gsmtc::EVT_INIT_ERROR, GsmtcInitError { message });
                }
            }
        })
        .expect("spawn gsmtc-init thread");

    Ok(())
}
