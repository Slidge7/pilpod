pub mod dto;

#[cfg(windows)]
mod mapping;
#[cfg(windows)]
pub(crate) mod state;
#[cfg(windows)]
mod thumbnail;

#[cfg(windows)]
pub use state::GsmtcState;

#[cfg(windows)]
pub mod commands {
    use std::sync::Arc;
    use tauri::State;
    use super::dto::GsmtcSnapshot;
    use super::state::GsmtcState;

    // NOTE: All commands are `async fn` on purpose. In Tauri 2 a plain `fn`
    // command runs on the **main thread**, and the WinRT `.get()` calls below
    // (and thumbnail reads inside `snapshot()`) block. Blocking the STA UI
    // thread shows the window as "Not Responding". `async fn` dispatches the
    // command onto Tauri's async runtime instead.

    fn run_blocking<F, R>(f: F) -> tauri::async_runtime::JoinHandle<R>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        tauri::async_runtime::spawn_blocking(f)
    }

    #[tauri::command]
    pub async fn gsmtc_refresh(
        state: State<'_, Arc<GsmtcState>>,
    ) -> Result<GsmtcSnapshot, String> {
        let state = Arc::clone(&state);
        run_blocking(move || state.snapshot())
            .await
            .map_err(|e| format!("join error: {e}"))?
    }

    #[tauri::command]
    pub async fn gsmtc_toggle_play_pause(
        state: State<'_, Arc<GsmtcState>>,
        session_index: u32,
    ) -> Result<(), String> {
        let state = Arc::clone(&state);
        run_blocking(move || {
            let session = state.session_at_index(session_index)?;
            session
                .TryTogglePlayPauseAsync()
                .map_err(|e| e.message().to_string())?
                .get()
                .map_err(|e| e.message().to_string())?;
            Ok::<(), String>(())
        })
        .await
        .map_err(|e| format!("join error: {e}"))?
    }

    #[tauri::command]
    pub async fn gsmtc_skip_next(
        state: State<'_, Arc<GsmtcState>>,
        session_index: u32,
    ) -> Result<(), String> {
        let state = Arc::clone(&state);
        run_blocking(move || {
            let session = state.session_at_index(session_index)?;
            session
                .TrySkipNextAsync()
                .map_err(|e| e.message().to_string())?
                .get()
                .map_err(|e| e.message().to_string())?;
            Ok::<(), String>(())
        })
        .await
        .map_err(|e| format!("join error: {e}"))?
    }

    #[tauri::command]
    pub async fn gsmtc_skip_previous(
        state: State<'_, Arc<GsmtcState>>,
        session_index: u32,
    ) -> Result<(), String> {
        let state = Arc::clone(&state);
        run_blocking(move || {
            let session = state.session_at_index(session_index)?;
            session
                .TrySkipPreviousAsync()
                .map_err(|e| e.message().to_string())?
                .get()
                .map_err(|e| e.message().to_string())?;
            Ok::<(), String>(())
        })
        .await
        .map_err(|e| format!("join error: {e}"))?
    }
}
