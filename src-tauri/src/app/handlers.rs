use tauri::Wry;

#[cfg(windows)]
pub fn with_invoke_handler(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder.invoke_handler(tauri::generate_handler![
        crate::browser_audio::mixer_set_volume,
        crate::browser_bridge::command::browser_media_control,
        crate::browser_commands::get_browsers,
        crate::browser_commands::refresh_browser_connection,
        crate::browser_commands::request_browser_sync,
        crate::window_widget::toggle_widget_mode,
        crate::dev_lab::open_dev_lab_window,
        crate::dev_lab::dev_scan_os_browsers,
        crate::dev_lab::dev_wake_and_sync_browser,
        crate::wallpaper::pick_wallpaper,
        crate::wallpaper::read_wallpaper,
    ])
}

#[cfg(not(windows))]
pub fn with_invoke_handler(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder.invoke_handler(tauri::generate_handler![
        crate::platform::stub_commands::browser_media_control,
        crate::platform::stub_commands::mixer_set_volume,
        crate::platform::stub_commands::toggle_widget_mode,
        crate::platform::stub_commands::get_browsers,
        crate::platform::stub_commands::refresh_browser_connection,
        crate::platform::stub_commands::request_browser_sync,
        crate::platform::stub_commands::open_dev_lab_window,
        crate::platform::stub_commands::dev_scan_os_browsers,
        crate::platform::stub_commands::dev_wake_and_sync_browser,
        crate::wallpaper::pick_wallpaper,
        crate::wallpaper::read_wallpaper,
    ])
}
