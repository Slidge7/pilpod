use tauri::Manager;

pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let browser_tabs: crate::browser_tabs::BrowserTabsMap =
        std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
    let browser_commands: crate::browser_tabs::BrowserCommandsQueue =
        std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
    let _ = app.manage(std::sync::Arc::clone(&browser_commands));
    let gsmtc_slot: std::sync::Arc<
        std::sync::Mutex<Option<std::sync::Arc<crate::gsmtc::GsmtcState>>>,
    > = std::sync::Arc::new(std::sync::Mutex::new(None));
    crate::browser_bridge::spawn(
        std::sync::Arc::clone(&browser_tabs),
        std::sync::Arc::clone(&browser_commands),
        handle.clone(),
        std::sync::Arc::clone(&gsmtc_slot),
    );
    // GSMTC uses WinRT async APIs whose `.get()` calls BLOCK the calling
    // thread. The Tauri main thread is the STA UI thread and must keep
    // pumping messages, so blocking it deadlocks the window
    // ("Not responding"). Run all init off the main thread.
    std::thread::Builder::new()
        .name("gsmtc-init".into())
        .spawn(move || {
            eprintln!("[gsmtc] init thread starting");
            match crate::gsmtc::GsmtcState::create(handle.clone(), browser_tabs) {
                Ok(state) => {
                    eprintln!("[gsmtc] init ok, managing state");
                    if let Ok(mut slot) = gsmtc_slot.lock() {
                        *slot = Some(std::sync::Arc::clone(&state));
                    }
                    let _ = handle.manage(state);
                }
                Err(err) => {
                    eprintln!("[gsmtc] init failed: {err:?}");
                }
            }
        })
        .expect("spawn gsmtc-init thread");
    Ok(())
}
