//! Universal media downloader (PREMIUM feature).
//!
//! Strictly isolated: integration points are exactly `lib.rs` (mod decl),
//! `app/handlers.rs` (command registration) and `app/setup.rs` (init call).
//! Never imports from the browser/media subsystems.
//!
//! Premium: every command in `commands.rs` starts with `require_premium()`.
//! Events: `dl://update`, `dl://progress`, `dl://complete`, `dl://error`,
//!         `dl://binary-status`.

pub mod binary;
pub mod commands;
pub mod filename;
pub mod formats;
pub mod persistence;
pub mod settings;
pub mod state;
pub mod worker;

use std::path::PathBuf;
use tauri::Manager;

pub const FEATURE: &str = "downloader";

pub const EVT_UPDATE: &str = "dl://update";
pub const EVT_PROGRESS: &str = "dl://progress";
pub const EVT_COMPLETE: &str = "dl://complete";
pub const EVT_ERROR: &str = "dl://error";
pub const EVT_BINARY_STATUS: &str = "dl://binary-status";

/// Resolve yt-dlp + ffmpeg via the binary lifecycle module (managed dir →
/// exe dir (externalBin) → resources → dev checkout).
pub fn resolve_binaries(handle: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    binary::resolve(handle)
}

/// Startup init: size the concurrency semaphore from settings, register
/// managed state, then (in the background) create the managed binary copies
/// so `yt-dlp -U` self-update works from a writable location.
pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let cfg = settings::load(&handle);
    let dl_state = state::DlState::new(cfg.concurrent_limit as usize);
    // Crash recovery: reload last session's queue; anything that was still
    // running is marked Error("interrupted") so the UI can offer Retry.
    persistence::restore_into(&dl_state, &handle);
    app.manage(dl_state);
    log::info!(
        "[downloader] init: concurrent_limit={} output_dir={}",
        cfg.concurrent_limit,
        cfg.output_dir
    );

    // First-run copy off the startup path — file I/O must not delay launch.
    tauri::async_runtime::spawn(async move {
        if let Err(e) = binary::ensure_managed_copies(&handle) {
            log::warn!("[downloader] managed copy skipped: {e}");
        }
    });
    Ok(())
}
