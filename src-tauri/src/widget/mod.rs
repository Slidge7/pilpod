//! The floating widget: a small always-on-top window that stays available
//! while the user works in other apps.
//!
//! ## Module map
//!
//! | file | responsibility |
//! |---|---|
//! | [`model`] | serialized value types — the contract with the frontend |
//! | [`geometry`] | pure placement math, unit-tested without a display |
//! | [`store`] | atomic JSON persistence, the swap seam for storage |
//! | [`state`] | in-memory source of truth, debounced saves, broadcast |
//! | [`window`] | the OS window: create, place, tear down |
//! | [`commands`] | the IPC surface |
//!
//! The layering runs strictly downward — `commands` → `window` → `geometry`,
//! with `state` as the shared spine — so the fiddly parts stay isolated:
//! multi-monitor math has no I/O, persistence has no window handles, and the
//! window layer makes no policy decisions.
//!
//! ## Design notes
//!
//! **Independent by construction.** The widget is its own top-level window,
//! not a resized `main`. Nothing about the dashboard's window state reaches
//! it. This replaces the old `window_widget` module, which achieved "widget
//! mode" by shrinking the main window and restoring saved bounds on the way
//! out — an approach that made the widget an artifact of minimizing the app.
//!
//! **Rust owns placement.** Two webviews read these settings and one of them
//! edits them, and the native side needs the value anyway to position the
//! window. One writer plus one event beats a cross-window sync protocol.
//!
//! **Cheap when off.** Disabled means the window does not exist — no hidden
//! webview holding a renderer process. The widget costs nothing until it is
//! turned on.

pub mod commands;
mod geometry;
// Public because `commands` and `state` name these types in their signatures.
pub mod model;
pub mod state;
mod store;
mod window;

pub use state::WidgetStore;

use tauri::{AppHandle, Manager};

/// Load persisted settings and restore the widget if it was left on.
///
/// Called from app setup. Window creation is deferred to the app's `Ready`
/// event by the caller so the main window exists first — the widget resolves
/// its monitor from the app's current screen.
pub fn init(app: &AppHandle) -> Result<(), String> {
    app.state::<WidgetStore>().hydrate(app);
    Ok(())
}

/// Bring the OS window in line with the persisted `enabled` flag.
pub fn restore(app: &AppHandle) {
    if let Err(e) = window::sync(app) {
        log::warn!("[widget] restore failed: {e}");
    }
}

/// Flush any debounced settings change before the process exits.
pub fn flush(app: &AppHandle) {
    app.state::<WidgetStore>().save_now();
}
