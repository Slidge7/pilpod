//! Auxiliary page windows: full PilPod pages that live in their own OS window.
//!
//! The dev lab and God Mode are both "a big page opened from the dashboard".
//! They share one shape — undecorated and transparent (the page paints its own
//! rim), resizable, loading the main `index.html` and routed by window label in
//! `App.tsx` — and one rule: asking for a window that already exists brings it
//! forward instead of opening a second copy.
//!
//! That shape used to be written out inline in `dev_lab`. With a second window
//! needing it, it lives here once, so a WebView2 argument or corner-clipping
//! fix lands on every auxiliary window at the same time.

use tauri::{AppHandle, Manager, WebviewWindowBuilder};

/// Everything that differs between auxiliary windows. Sizes are logical pixels.
#[derive(Debug, Clone, Copy)]
pub struct AuxWindowSpec {
    /// Window *and* webview label — the frontend routes on it.
    pub label: &'static str,
    pub title: &'static str,
    pub size: (f64, f64),
    pub min_size: (f64, f64),
}

/// Open the window described by `spec`, or focus it if it is already open.
pub async fn open(app: AppHandle, spec: AuxWindowSpec) -> Result<(), String> {
    // Window creation must not run on the WebView thread (deadlocks on Windows).
    tauri::async_runtime::spawn_blocking(move || create_or_focus(&app, &spec))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn create_or_focus(app: &AppHandle, spec: &AuxWindowSpec) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(spec.label) {
        // A minimized window ignores `set_focus` on Windows: restore it first,
        // or the click that asked for it appears to do nothing.
        if window.is_minimized().unwrap_or(false) {
            window.unminimize().map_err(|e| e.to_string())?;
        }
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }

    let url = crate::frontend::url(app, "index.html");
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, spec.label, url)
        .title(spec.title)
        .inner_size(spec.size.0, spec.size.1)
        .min_inner_size(spec.min_size.0, spec.min_size.1)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .shadow(false);

    // Every window in the process must request the same WebView2 arguments or
    // environment creation fails — see `inapp_player::agent::BROWSER_ARGS`.
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args(crate::inapp_player::agent::BROWSER_ARGS);
    }

    let window = builder.build().map_err(|e| e.to_string())?;

    #[cfg(windows)]
    crate::platform::window_corners::apply(&window);

    if let Err(e) = window.set_icon(tauri::include_image!("icons/icon.ico")) {
        log::warn!("[{}] window icon: {e}", spec.label);
    }

    Ok(())
}
