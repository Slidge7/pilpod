//! Where a window's document comes from.
//!
//! ## The bug this module exists to prevent
//!
//! Every extra window (widget, in-app player, dev lab) has to resolve its own
//! URL, because Tauri only resolves the *main* window's from the config. The
//! obvious way to write that is:
//!
//! ```ignore
//! if let Some(dev_url) = app.config().build.dev_url.clone() {
//!     return WebviewUrl::External(dev_url);   // WRONG
//! }
//! WebviewUrl::App("index.html".into())
//! ```
//!
//! It reads as "dev server if there is one, bundled asset otherwise" — but
//! `build.devUrl` is part of `tauri.conf.json`, and the whole config is baked
//! into the binary at compile time. It is `Some("http://localhost:1420/")` in
//! a release build exactly as it is in `tauri dev`. So the release build asks
//! WebView2 for a dev server that is not running, and the window comes up
//! blank. `npm run tauri dev` can never catch it, because in dev the branch is
//! genuinely correct.
//!
//! Tauri's own answer is the *build profile*, not the config: `is_dev()` is a
//! compile-time flag. This module is the only place allowed to read
//! `build.dev_url`, and it reads it behind that gate.

use tauri::{AppHandle, Manager, WebviewUrl};

/// The dev server's base URL — `Some` only when this binary was built by
/// `tauri dev`. In a bundled app it is always `None`, whatever the config says.
pub fn dev_base(app: &AppHandle) -> Option<tauri::Url> {
    if !tauri::is_dev() {
        return None;
    }
    app.config().build.dev_url.clone()
}

/// Resolve a frontend document by its path relative to the frontend root
/// (`"index.html"`, `"widget.html"`, …).
///
/// In dev that is the Vite server plus the path; in a bundle it is the asset
/// of the same name emitted by the Rollup build.
pub fn url(app: &AppHandle, path: &str) -> WebviewUrl {
    if let Some(base) = dev_base(app) {
        if let Ok(joined) = base.join(path) {
            return WebviewUrl::External(joined);
        }
    }
    WebviewUrl::App(path.into())
}
