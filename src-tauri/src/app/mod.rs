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
    }

    // Single setup closure: premium entitlement init runs on ALL platforms,
    // then the Windows-only subsystem init.
    builder = builder.setup(|app| {
        crate::premium::init(app)?;
        // Vault is platform-neutral (pure file I/O) — init on all platforms.
        crate::vault::init(app)?;
        #[cfg(windows)]
        {
            crate::downloader::init(app)?;
            setup::init(app)?;
        }
        Ok(())
    });

    builder = handlers::with_invoke_handler(builder);

    let context = tauri::generate_context!();

    #[cfg(windows)]
    {
        let app = builder
            .build(context)
            .expect("error while building tauri application");
        app.run(|app_handle, event| match event {
            tauri::RunEvent::Ready => {
                setup::apply_main_window_icon(app_handle);
            }
            // Flush any unsaved vault edits before the process goes away.
            tauri::RunEvent::Exit => {
                crate::vault::flush(app_handle);
            }
            _ => {}
        });
        return;
    }

    #[cfg(not(windows))]
    builder
        .run(context)
        .expect("error while running tauri application");
}
