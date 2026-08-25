mod handlers;
#[cfg(windows)]
mod setup;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    builder = builder.plugin(tauri_plugin_dialog::init());

    // Placement + enabled state for the floating widget. Managed on every
    // platform: the dashboard menu and the widget window both read it, and the
    // native side needs it to position the window.
    builder = builder.manage(crate::widget::WidgetStore::default());

    // Single setup closure: premium entitlement init runs on ALL platforms,
    // then the Windows-only subsystem init.
    builder = builder.setup(|app| {
        crate::premium::init(app)?;
        // Vault is platform-neutral (pure file I/O) — init on all platforms.
        crate::vault::init(app)?;
        // Reads persisted widget settings into memory. The OS window is left
        // for `Ready` so the main window exists first — the widget resolves
        // its monitor from the screen the app is already on.
        crate::widget::init(&app.handle().clone())?;
        // The tray icon and the close-means-hide rule. Set up here, after the
        // widget store exists and while `main` is guaranteed to be alive.
        if let Err(e) = crate::background::init(&app.handle().clone()) {
            log::warn!("[pilpod] background mode unavailable: {e}");
        }
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
                // Settle the app into the shape the user left it in: an
                // ordinary window, or the dashboard as a flyout anchored to
                // the chip's corner.
                crate::background::restore(app_handle);
            }
            // The dashboard being *destroyed* still ends PilPod.
            //
            // Tauri's "exit when the last window closes" rule cannot be relied
            // on here: the widget is a real second window, so with it on the
            // app would sit around showing nothing but a chip. When the main
            // window is genuinely gone, so are we.
            //
            // Reaching this at all means the close was allowed through — with
            // the widget on, `background::init` intercepts it and hides the
            // window instead, and nothing is destroyed.
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } if label == "main" => {
                app_handle.exit(0);
            }
            // Flush any unsaved vault edits before the process goes away.
            tauri::RunEvent::Exit => {
                crate::vault::flush(app_handle);
                crate::widget::flush(app_handle);
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
