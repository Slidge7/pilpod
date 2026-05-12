mod gsmtc;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(windows)]
    {
        builder = builder.setup(|app| {
            let handle = app.handle().clone();
            // GSMTC uses WinRT async APIs whose `.get()` calls BLOCK the calling
            // thread. The Tauri main thread is the STA UI thread and must keep
            // pumping messages, so blocking it deadlocks the window
            // ("Not responding"). Run all init off the main thread.
            std::thread::Builder::new()
                .name("gsmtc-init".into())
                .spawn(move || {
                    eprintln!("[gsmtc] init thread starting");
                    match gsmtc::GsmtcState::create(handle.clone()) {
                        Ok(state) => {
                            eprintln!("[gsmtc] init ok, managing state");
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
        ]);
    }

    #[cfg(not(windows))]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            gsmtc_refresh,
            gsmtc_toggle_play_pause,
            gsmtc_skip_next,
            gsmtc_skip_previous,
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
fn gsmtc_toggle_play_pause(_aumid: String) -> Result<(), String> {
    Err("OmniMedia requires Windows".into())
}

#[cfg(not(windows))]
#[tauri::command]
fn gsmtc_skip_next(_aumid: String) -> Result<(), String> {
    Err("OmniMedia requires Windows".into())
}

#[cfg(not(windows))]
#[tauri::command]
fn gsmtc_skip_previous(_aumid: String) -> Result<(), String> {
    Err("OmniMedia requires Windows".into())
}
