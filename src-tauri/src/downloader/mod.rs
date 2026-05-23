pub mod binary;
pub mod commands;
pub mod formats;
pub mod settings;
pub mod state;
pub mod worker;

use state::{DownloadManager, DownloadManagerState};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

/// Called from `app/setup.rs` during app init.
/// Loads settings, copies bundled binaries if present, and returns the
/// managed state that must be registered with `app.manage(...)`.
pub fn init(app: &AppHandle) -> DownloadManagerState {
    // Ensure bin dir exists and copy bundled binaries synchronously.
    binary::ensure_binaries_sync(app);

    // Load persisted settings (or defaults).
    let loaded_settings = settings::load(app);

    let manager = DownloadManager::new(loaded_settings);
    Arc::new(Mutex::new(manager))
}
