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
//! **Its own window, but the app's stand-in.** The widget is a top-level
//! window rather than a resized `main` — the old `window_widget` module got
//! "widget mode" by shrinking the dashboard, which is why the widget could only
//! exist while the app was minimized. What the two windows *do* share is a
//! rule, and it lives in [`crate::background`]: one PilPod surface at a time.
//! Turning the widget on sends the dashboard away and leaves the app running in
//! the tray; clicking the chip brings the dashboard back and takes the chip off
//! screen. The chip is not a miniature of the app — it is the door back to it.
//!
//! **The chip has no UI of its own.** It used to expand into a media panel;
//! that panel is gone. Clicking opens the real window, so there is one place
//! media controls live and no second, smaller version of the dashboard to keep
//! in sync with the first. What survived the panel is its *geometry*: the
//! dashboard now opens anchored to the chip's corner, growing inward exactly as
//! the panel did, so clicking still reads as the chip unfolding. That math is
//! [`window::anchor_from_chip`], and it is the reason the chip is built and
//! placed even at moments when it is not shown.
//!
//! **Rust owns placement.** Two webviews read these settings and one of them
//! edits them, and the native side needs the value anyway to position the
//! window. One writer plus one event beats a cross-window sync protocol.
//!
//! **Cheap when off, cheap to flip.** Disabled means the window does not exist
//! — no hidden webview holding a renderer process, so the widget costs nothing
//! until it is turned on. *Suppressed* (enabled, but the dashboard is in front)
//! only hides it: that is a round trip the user makes many times a session, and
//! rebuilding the webview each way would leave the chip blank for a beat every
//! time they close the window.

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

/// Is the widget turned on? Read by [`crate::background`] to decide what
/// closing the dashboard means.
pub fn is_enabled(app: &AppHandle) -> bool {
    app.state::<WidgetStore>().is_enabled()
}

/// Reconcile the chip with the widget setting and where the app currently is.
pub fn sync(app: &AppHandle) -> Result<(), String> {
    window::sync(app)
}

/// Build and place the chip without showing it.
///
/// Called when the dashboard needs something to anchor to but the chip itself
/// should stay unseen — see [`window::ensure_placed`].
pub fn place_chip(app: &AppHandle) {
    if let Err(e) = window::ensure_placed(app) {
        log::warn!("[widget] placement failed: {e}");
    }
}

/// Where a `win_w × win_h` window should sit to look like it unfolded from the
/// chip. See [`window::anchor_from_chip`].
pub fn anchor_from_chip(app: &AppHandle, win_w: i32, win_h: i32) -> Option<(i32, i32)> {
    window::anchor_from_chip(app, win_w, win_h)
}

/// Take the chip off screen without turning the widget off.
///
/// Used when the dashboard comes forward: the widget is still enabled, it is
/// simply not the surface in use.
pub fn hide(app: &AppHandle) {
    if let Err(e) = window::hide(app) {
        log::warn!("[widget] hide failed: {e}");
    }
}

/// Bring the OS window in line with the persisted `enabled` flag.
///
/// At startup the dashboard is on screen, so this is normally a no-op that
/// leaves the chip unbuilt: launching PilPod shows PilPod, and the chip takes
/// over only once the window goes away.
pub fn restore(app: &AppHandle) {
    if let Err(e) = window::sync(app) {
        log::warn!("[widget] restore failed: {e}");
    }
}

/// Flush any debounced settings change before the process exits.
pub fn flush(app: &AppHandle) {
    app.state::<WidgetStore>().save_now();
}
