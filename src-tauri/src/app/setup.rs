use tauri::{AppHandle, Manager};

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

    // Bundled browser icons: resource dir in production, source dir in dev.
    {
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();
        if let Ok(res) = handle.path().resource_dir() {
            candidates.push(res.join("icons").join("browsers"));
        }
        candidates.push(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("icons")
                .join("browsers"),
        );
        crate::browser_icon::init(&candidates);
    }

    // Stable profile numbering (Phase 4).
    if let Ok(data_dir) = handle.path().app_data_dir() {
        crate::browser_profile_order::init(data_dir);
    }

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

    // Playlist player session state (reads vault, drives the bridge).
    crate::playlist_player::init(app);

    let sync_flag: crate::browser_bridge::SyncRequestedFlag = std::sync::Arc::new(
        std::sync::atomic::AtomicBool::new(false),
    );

    let _ = app.manage(std::sync::Arc::clone(&browser_commands));
    let _ = app.manage(std::sync::Arc::clone(&detected_browsers));
    let _ = app.manage(std::sync::Arc::clone(&browser_slots));
    let _ = app.manage(std::sync::Arc::clone(&ext_store));
    let _ = app.manage(std::sync::Arc::clone(&sync_flag));
    let _ = app.manage(std::sync::Arc::clone(&reconnecting));
    let _ = app.manage(std::sync::Arc::clone(&ws_connections));

    crate::browser_bridge::spawn(
        std::sync::Arc::clone(&browser_slots),
        std::sync::Arc::clone(&browser_commands),
        handle.clone(),
        std::sync::Arc::clone(&detected_browsers),
        std::sync::Arc::clone(&ext_store),
        std::sync::Arc::clone(&reconnecting),
        std::sync::Arc::clone(&sync_flag),
        std::sync::Arc::clone(&ws_connections),
    );

    crate::browser_detector::spawn_detector(
        std::sync::Arc::clone(&detected_browsers),
        std::sync::Arc::clone(&browser_slots),
        std::sync::Arc::clone(&ext_store),
        std::sync::Arc::clone(&reconnecting),
        ws_connections,
        handle,
    );

    Ok(())
}
