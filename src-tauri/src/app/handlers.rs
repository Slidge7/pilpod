use tauri::Wry;

#[cfg(windows)]
pub fn with_invoke_handler(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder.invoke_handler(tauri::generate_handler![
        crate::gsmtc::commands::gsmtc_refresh,
        crate::gsmtc::commands::gsmtc_toggle_play_pause,
        crate::gsmtc::commands::gsmtc_skip_next,
        crate::gsmtc::commands::gsmtc_skip_previous,
        crate::browser_bridge::command::browser_media_control,
        crate::gsmtc::commands::mixer_set_volume,
        crate::window_widget::toggle_widget_mode,
        crate::gsmtc::commands::get_browsers,
        crate::gsmtc::commands::refresh_browser_connection,
        crate::gsmtc::commands::request_browser_sync,
    ])
}

#[cfg(not(windows))]
pub fn with_invoke_handler(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder.invoke_handler(tauri::generate_handler![
        crate::platform::stub_commands::gsmtc_refresh,
        crate::platform::stub_commands::gsmtc_toggle_play_pause,
        crate::platform::stub_commands::gsmtc_skip_next,
        crate::platform::stub_commands::gsmtc_skip_previous,
        crate::platform::stub_commands::browser_media_control,
        crate::platform::stub_commands::mixer_set_volume,
        crate::platform::stub_commands::toggle_widget_mode,
        crate::platform::stub_commands::get_browsers,
        crate::platform::stub_commands::refresh_browser_connection,
        crate::platform::stub_commands::request_browser_sync,
    ])
}
