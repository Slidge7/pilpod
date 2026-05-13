#[cfg(windows)]
mod browser_bridge;
mod gsmtc;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(windows)]
    {
        builder = builder.setup(|app| {
            let handle = app.handle().clone();
            let browser_tabs: browser_bridge::BrowserTabsMap =
                std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
            let browser_commands: browser_bridge::BrowserCommandsQueue =
                std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
            let _ = app.manage(std::sync::Arc::clone(&browser_commands));
            let gsmtc_slot: std::sync::Arc<
                std::sync::Mutex<Option<std::sync::Arc<gsmtc::GsmtcState>>>,
            > = std::sync::Arc::new(std::sync::Mutex::new(None));
            browser_bridge::spawn(
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
                    match gsmtc::GsmtcState::create(handle.clone(), browser_tabs) {
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
        });
        builder = builder.invoke_handler(tauri::generate_handler![
            gsmtc::commands::gsmtc_refresh,
            gsmtc::commands::gsmtc_toggle_play_pause,
            gsmtc::commands::gsmtc_skip_next,
            gsmtc::commands::gsmtc_skip_previous,
            browser_bridge::browser_media_control,
        ]);
    }

    #[cfg(not(windows))]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            gsmtc_refresh,
            gsmtc_toggle_play_pause,
            gsmtc_skip_next,
            gsmtc_skip_previous,
            browser_media_control,
        ]);
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(windows))]
#[tauri::command]
fn gsmtc_refresh() -> Result<gsmtc::dto::GsmtcSnapshot, String> {
    Err("OmniMedia requires Windows".into())
}

#[cfg(not(windows))]
#[tauri::command]
fn gsmtc_toggle_play_pause(_session_index: u32) -> Result<(), String> {
    Err("OmniMedia requires Windows".into())
}

#[cfg(not(windows))]
#[tauri::command]
fn gsmtc_skip_next(_session_index: u32) -> Result<(), String> {
    Err("OmniMedia requires Windows".into())
}

#[cfg(not(windows))]
#[tauri::command]
fn gsmtc_skip_previous(_session_index: u32) -> Result<(), String> {
    Err("OmniMedia requires Windows".into())
}

#[cfg(not(windows))]
#[tauri::command]
fn browser_media_control(
    _browser_id: String,
    _tab_id: i32,
    _action: String,
) -> Result<(), String> {
    Err("OmniMedia requires Windows".into())
}
