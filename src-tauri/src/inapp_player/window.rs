//! Player window lifecycle.
//!
//! ONE window, TWO webviews:
//!
//! ```text
//! ┌───────────────────────────────┐
//! │  title bar (drag · minimise · close)   ← player-ui
//! ├───────────────────────────────┤
//! │  player-stage  (site page)    │  16:9 rectangle, laid OVER the UI's
//! │  video only, chrome stripped  │  reserved slot
//! ├───────────────────────────────┤
//! │  now playing · transport      │  ← player-ui
//! │  track list · footer          │
//! └───────────────────────────────┘
//! ```
//!
//! `player-ui` fills the whole window and reserves an empty slot for the video;
//! `player-stage` is created second (so it sits on top) and is positioned into
//! that slot. That is what puts PilPod's own title bar at the very top of the
//! window rather than under the video — the two webviews overlap by design,
//! and [`HEADER_H`] is the contract between them.
//!
//! The stage stays a *remote* webview (any site, no extension). The UI is a
//! normal local Tauri webview, so the playlist chrome is React with real IPC
//! instead of DOM injected into someone else's page. Both are recreated never
//! and reused always: tracks navigate the stage, the UI is untouched.

use tauri::webview::WebviewBuilder;
use tauri::window::WindowBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WindowEvent};

/// Window label. Also the security boundary for the capability that grants the
/// UI webview its window controls.
pub const PLAYER_LABEL: &str = "pilpod-player";
/// Remote site page — the video surface. Never granted any Tauri command.
pub const STAGE_LABEL: &str = "player-stage";
/// PilPod's own playlist UI.
pub const UI_LABEL: &str = "player-ui";

/// Phone-shaped: the stage is served the site's mobile layout.
const PHONE_W: f64 = 400.0;
const PHONE_H: f64 = 760.0;
const MIN_W: f64 = 320.0;
const MIN_H: f64 = 520.0;

/// Height of PilPod's title bar, in logical pixels. **Mirrored in
/// `PlayerWindow.css` (`.pilpod-pw-head`)**: the stage is positioned at exactly
/// this offset, so if one changes the other must too.
const HEADER_H: f64 = 34.0;

/// The stage is a 16:9 rectangle under the title bar; the UI takes the rest.
const STAGE_ASPECT: f64 = 9.0 / 16.0;

fn stage_height(width: f64) -> f64 {
    (width * STAGE_ASPECT).round()
}

/// Window work must never run on the webview thread — it deadlocks on Windows
/// (same discipline as `dev_lab::open_dev_lab_window`).
fn on_worker<F>(app: &AppHandle, f: F)
where
    F: FnOnce(AppHandle) + Send + 'static,
{
    let app = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || f(app));
}

/// What the stage webview should be showing.
#[derive(Debug, Clone)]
pub enum StageTarget {
    /// PilPod's own page (`StageView`), which drives the YouTube IFrame API.
    Local,
    /// A site's page, stripped down in place by the injected agent.
    Remote(tauri::Url),
}

/// Point the stage at `target`, creating the window on first use.
pub fn open_or_navigate(app: &AppHandle, target: StageTarget) {
    on_worker(app, move |app| {
        if app.get_webview(STAGE_LABEL).is_some() {
            navigate_stage(&app, &target);
            return;
        }
        if let Err(e) = create(&app, &target) {
            eprintln!("[inapp] player window create failed: {e}");
            super::on_window_failed(&app, &e);
        }
    });
}

/// The origin PilPod's own pages are served from. Read off the UI webview
/// rather than assumed, so it is right in dev (the Vite server) and in release
/// (the asset protocol) without special-casing either.
fn local_url(app: &AppHandle) -> Option<tauri::Url> {
    if let Some(ui) = app.get_webview(UI_LABEL) {
        if let Ok(url) = ui.url() {
            return Some(url);
        }
    }
    app.config().build.dev_url.clone()
}

fn navigate_stage(app: &AppHandle, target: &StageTarget) {
    let Some(stage) = app.get_webview(STAGE_LABEL) else { return };
    match target {
        StageTarget::Remote(url) => {
            let _ = stage.navigate(url.clone());
        }
        StageTarget::Local => {
            // Already on our own page? The stage re-renders from the
            // `inapp://stage` event instead of reloading — reloading would
            // restart the IFrame API for nothing.
            let on_local = stage
                .url()
                .ok()
                .zip(local_url(app))
                .is_some_and(|(now, local)| now.origin() == local.origin());
            if !on_local {
                if let Some(url) = local_url(app) {
                    let _ = stage.navigate(url);
                }
            }
        }
    }
}

pub fn close(app: &AppHandle) {
    on_worker(app, |app| {
        if let Some(win) = app.get_window(PLAYER_LABEL) {
            let _ = win.destroy();
        }
    });
}

pub fn minimize(app: &AppHandle) {
    on_worker(app, |app| {
        if let Some(win) = app.get_window(PLAYER_LABEL) {
            let _ = win.minimize();
        }
    });
}

pub fn focus(app: &AppHandle) {
    on_worker(app, |app| {
        if let Some(win) = app.get_window(PLAYER_LABEL) {
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    });
}

/// Hand the window to the OS move loop. The player window has no decorations,
/// so its header drags through this rather than through `data-tauri-drag-region`
/// — a plain app command works regardless of how the UI webview's capability
/// resolves, which the drag-region path does not.
pub fn start_drag(app: &AppHandle) -> bool {
    match app.get_window(PLAYER_LABEL) {
        Some(win) => {
            let _ = win.start_dragging();
            true
        }
        None => false,
    }
}

/// Run a command frame inside the site page.
pub fn eval(app: &AppHandle, js: String) -> bool {
    match app.get_webview(STAGE_LABEL) {
        Some(stage) => {
            let _ = stage.eval(js);
            true
        }
        None => false,
    }
}

pub fn exists(app: &AppHandle) -> bool {
    app.get_webview(STAGE_LABEL).is_some()
}

/// Re-tile both webviews. Called on every window resize; cheap enough to run
/// synchronously from the event handler.
pub fn relayout(app: &AppHandle) {
    let Some(win) = app.get_window(PLAYER_LABEL) else { return };
    let (Some(stage), Some(ui)) = (app.get_webview(STAGE_LABEL), app.get_webview(UI_LABEL)) else {
        return;
    };
    let Ok(physical) = win.inner_size() else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let size: LogicalSize<f64> = physical.to_logical(scale);
    let stage_h = stage_height(size.width).min((size.height - HEADER_H).max(1.0));

    // The UI owns the whole window; the stage floats over its reserved slot.
    let _ = ui.set_position(LogicalPosition::new(0.0, 0.0));
    let _ = ui.set_size(LogicalSize::new(size.width, size.height));
    let _ = stage.set_position(LogicalPosition::new(0.0, HEADER_H));
    let _ = stage.set_size(LogicalSize::new(size.width, stage_h));
}

/// Where the UI webview's document lives — dev server in dev, bundled asset in
/// release (same resolution `dev_lab` uses).
fn ui_url(app: &AppHandle) -> WebviewUrl {
    match app.config().build.dev_url.clone() {
        Some(dev_url) => WebviewUrl::External(dev_url),
        None => WebviewUrl::App("index.html".into()),
    }
}

fn create(app: &AppHandle, target: &StageTarget) -> Result<(), String> {
    let win = WindowBuilder::new(app, PLAYER_LABEL)
        .title("PilPod Player")
        .inner_size(PHONE_W, PHONE_H)
        .min_inner_size(MIN_W, MIN_H)
        .resizable(true)
        .decorations(false)
        .build()
        .map_err(|e| format!("window: {e}"))?;

    let stage_h = stage_height(PHONE_W);

    // ── the playlist UI: PilPod's own React surface, the full window ───────
    // Created FIRST so the stage, added second, sits on top of its slot.
    #[allow(unused_mut)]
    let mut ui = WebviewBuilder::new(UI_LABEL, ui_url(app));

    #[cfg(windows)]
    {
        ui = ui.additional_browser_args(super::agent::BROWSER_ARGS);
    }

    win.add_child(
        ui,
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(PHONE_W, PHONE_H),
    )
    .map_err(|e| format!("ui webview: {e}"))?;

    // ── the video stage ───────────────────────────────────────────────────
    // Either PilPod's own page (YouTube, via the IFrame API) or a site's page
    // stripped down in place. Both are the same webview: it navigates between
    // the two as the playlist moves from one kind of track to the next.
    let stage_url = match target {
        StageTarget::Remote(url) => WebviewUrl::External(url.clone()),
        StageTarget::Local => ui_url(app),
    };
    let init = super::agent::script();
    let nav_app = app.clone();

    #[allow(unused_mut)]
    let mut stage = WebviewBuilder::new(STAGE_LABEL, stage_url)
        .initialization_script(init)
        .user_agent(super::agent::MOBILE_UA)
        .on_navigation(move |url| super::bridge::intercept(&nav_app, url));

    // MUST match every other webview in the process — see `agent::BROWSER_ARGS`.
    // Unset is not neutral: wry substitutes its own default, which disagrees
    // with the configured value, and WebView2 then refuses the environment.
    #[cfg(windows)]
    {
        stage = stage.additional_browser_args(super::agent::BROWSER_ARGS);
    }

    win.add_child(
        stage,
        LogicalPosition::new(0.0, HEADER_H),
        LogicalSize::new(PHONE_W, stage_h),
    )
    .map_err(|e| format!("stage webview: {e}"))?;

    let ev_app = app.clone();
    win.on_window_event(move |event| match event {
        WindowEvent::Destroyed => super::on_window_gone(&ev_app),
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => relayout(&ev_app),
        _ => {}
    });

    Ok(())
}
