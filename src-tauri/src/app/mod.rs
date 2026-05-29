mod handlers;
#[cfg(windows)]
mod setup;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    builder = builder.plugin(tauri_plugin_dialog::init());

    #[cfg(windows)]
    {
        builder = builder.manage(crate::window_widget::RestoreBounds::default());
        builder = builder.setup(setup::init);
    }

    builder = handlers::with_invoke_handler(builder);

    let context = tauri::generate_context!();

    #[cfg(windows)]
    {
        let app = builder
            .build(context)
            .expect("error while building tauri application");
        app.run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::Ready) {
                setup::apply_main_window_icon(app_handle);
            }
        });
        return;
    }

    #[cfg(not(windows))]
    builder
        .run(context)
        .expect("error while running tauri application");
}
