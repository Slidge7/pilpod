//! Background mode: PilPod running with no main window on screen.
//!
//! ## The rule
//!
//! Exactly one PilPod surface is visible at a time. Either the dashboard is up
//! — the app as the user knows it — or it is away and the floating chip stands
//! in for it. Clicking the chip (or the tray icon) brings the dashboard back;
//! clicking away, or closing it, puts it down again.
//!
//! Turning the widget on does *not* itself send the dashboard away. It changes
//! what the window is — a flyout rather than a window — and lets the next
//! click-away do the moving. Enabling a setting should never look like the app
//! quitting.
//!
//! That is why this module exists rather than the two windows poking at each
//! other: the transition is a single decision about *where the app is*, and it
//! has to move both windows in the right order or the user sees a frame with
//! both, or neither.
//!
//! ## Why the app survives a closed dashboard
//!
//! Before the widget, closing the dashboard *was* quitting: the main window is
//! the app. With the widget on, closing has to mean "put it away" instead, so
//! `main`'s close is intercepted (see `app::run`) and turned into a hide. The
//! process then has no visible top-level window, which on Windows means the
//! only way back would be the chip — one accidental drag off-screen from being
//! unreachable. Hence the tray icon: PilPod keeps a presence in the
//! notification area for as long as it is running in the background.
//!
//! ## With the widget on, the dashboard is a flyout
//!
//! Not a window that happens to be hidden — a flyout, the way a tray popup or a
//! menu behaves. It opens *at the chip*, anchored to the same screen corner so
//! it looks like the chip unfolding; it keeps out of the taskbar and Alt+Tab
//! while it is one; and it dismisses itself the moment the user's attention
//! goes elsewhere — whether or not they ever touched it. Turn the widget off
//! and it goes back to being an ordinary window: taskbar button, stays where
//! you put it, closes when you close it.
//!
//! ## Visibility is read, never mirrored
//!
//! Whether the dashboard is on screen is asked of the OS window, not tracked in
//! a flag. A mirrored copy is one missed event away from disagreeing with what
//! the user can see — and the widget's whole behaviour hangs off this answer.

mod flyout;
mod tray;

use tauri::{AppHandle, Manager};

pub const MAIN_LABEL: &str = "main";

/// Is the dashboard on screen right now?
///
/// A minimized window still counts as visible to Win32, and deliberately so:
/// minimizing leaves a taskbar button, so the app has not gone anywhere and the
/// chip should stay out of the way. Only `hide()` removes it from the taskbar,
/// and only that puts us in background mode.
pub fn main_is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Bring the dashboard back and stand the chip down.
///
/// The everyday entry point: the chip was clicked, or the tray icon was. It
/// re-places the dashboard only when the dashboard is actually arriving — see
/// [`open_main`] for what "re-place" means and why the rest of the order is
/// load-bearing.
pub fn show_main(app: &AppHandle) -> Result<(), String> {
    // Asking for the dashboard while it is already up — clicking the chip
    // during a settings preview, or the tray icon out of habit — should focus
    // it, not yank it across the screen.
    let arriving = !main_is_visible(app);
    open_main(app, arriving)
}

/// Put the dashboard on screen, optionally moving it to the chip first.
///
/// ## The order is the whole function
///
/// 1. **Measure the chip.** Its rect is what the dashboard anchors to, so this
///    has to happen while it is still placed.
/// 2. **Show and focus the dashboard.**
/// 3. **Only then reconcile the chip**, which normally means hiding it.
///
/// Steps 2 and 3 were once the other way round, and it cost the flyout its
/// dismissal. On Windows, `SetForegroundWindow` is only granted to a process
/// that already owns the foreground — and the chip, having just been clicked,
/// *was* that window. Hiding it first handed the foreground to whatever was
/// behind it, some other application, and our focus request was then quietly
/// refused. The dashboard appeared, unfocused, and never blurred because it had
/// never been focused: it sat there until the user clicked it once to wake it
/// up. Showing first keeps the foreground inside this process for the handover.
///
/// The chip is hidden rather than destroyed: this is a round trip the user may
/// make many times an hour, and rebuilding a webview each way is hundreds of
/// milliseconds of dead chip. Reconciled through `sync` rather than hidden
/// outright so the settings-panel preview, which deliberately keeps it up
/// alongside the dashboard, survives the transition.
fn open_main(app: &AppHandle, reanchor: bool) -> Result<(), String> {
    let Some(main) = app.get_webview_window(MAIN_LABEL) else {
        return Err("main window not found".to_string());
    };

    // With the widget on the dashboard is a flyout, so it opens at the chip and
    // stays out of the taskbar. With it off it is an ordinary window and none of
    // this applies — including on the way *out* of widget mode, where this call
    // is what hands the taskbar button back.
    let as_flyout = crate::widget::is_enabled(app);
    if as_flyout && reanchor {
        flyout::anchor_to_chip(app, &main);
    }
    #[cfg(any(windows, target_os = "linux"))]
    let _ = main.set_skip_taskbar(as_flyout);

    // `show` alone does not restore a minimized window on Windows, and
    // `set_focus` on a minimized window is a no-op — both are needed, in this
    // order, for every way the dashboard can be away.
    if main.is_minimized().unwrap_or(false) {
        main.unminimize().map_err(|e| e.to_string())?;
    }
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;

    crate::widget::sync(app)?;

    if as_flyout {
        flyout::watch_for_click_away(app);
    }
    Ok(())
}

/// Turn the dashboard into a flyout, leaving it exactly where it is.
///
/// This is what turning the widget on does now. It used to hide the window on
/// the spot, and that read as the app quitting: you press a small button in the
/// header and PilPod vanishes, with a chip in the corner as the only evidence
/// it is still running. Nothing about enabling the widget requires the window
/// to leave — it only decides what happens *next* time attention moves away. So
/// the window stays, and the first click-away is what puts it down.
///
/// The chip is built here, hidden, rather than left for that first dismissal.
/// Building a webview costs a few hundred milliseconds, and paying it at the
/// moment the dashboard disappears would leave an empty corner in the gap.
pub fn enter_flyout_mode(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(MAIN_LABEL).is_none() {
        return Err("main window not found".to_string());
    }

    crate::widget::place_chip(app);
    // Normally a no-op right now — the dashboard is on screen, so the chip
    // stays hidden. It is not a no-op when the widget's own settings panel is
    // open, which is the other place this gets switched on: there the chip is
    // meant to appear immediately, as the preview of what was just enabled.
    crate::widget::sync(app)?;

    #[cfg(any(windows, target_os = "linux"))]
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.set_skip_taskbar(true);
    }

    flyout::watch_for_click_away(app);
    Ok(())
}

/// Send the dashboard away. With the widget on, the chip takes its place.
///
/// `hide` rather than `close`: closing destroys the webview and everything the
/// dashboard is holding — the browser feed subscription, scroll positions —
/// and the user asked for the app to go to the
/// background, not to restart next time they click the chip.
pub fn hide_main(app: &AppHandle) -> Result<(), String> {
    let Some(main) = app.get_webview_window(MAIN_LABEL) else {
        return Err("main window not found".to_string());
    };
    main.hide().map_err(|e| e.to_string())?;
    // Reconciles against the visibility we just changed: the chip appears iff
    // the widget is enabled.
    crate::widget::sync(app)
}

/// Put the app into the shape the user left it in, once the windows are up.
///
/// With the widget off this is just the widget's own reconcile — nothing to do.
/// With it on, the dashboard that has just appeared is a *flyout*, so it should
/// look like one from the first frame rather than from the first time it is
/// closed: the chip is placed (unseen) to anchor against, and the dashboard is
/// re-opened against it. PilPod therefore always appears in the same corner,
/// whether it was launched or clicked.
pub fn restore(app: &AppHandle) {
    if !crate::widget::is_enabled(app) {
        crate::widget::restore(app);
        return;
    }
    crate::widget::place_chip(app);
    // Forced re-anchor: the dashboard is already on screen at this point — at
    // the position Tauri gave it — and the whole point is to move it to the
    // corner it belongs in.
    if let Err(e) = open_main(app, true) {
        log::warn!("[background] flyout restore failed: {e}");
    }
}

/// Wire background mode up: the tray icon, and the two ways a flyout goes away
/// — the close button, and losing focus.
///
/// Called from app setup, where `main` already exists.
pub fn init(app: &AppHandle) -> Result<(), String> {
    tray::init(app)?;
    watch_main_window(app);
    Ok(())
}

/// Turn the dashboard's close button into "put PilPod away", while the widget
/// is on.
///
/// Without the widget there is nothing left to represent the app, so closing
/// keeps its original meaning and the process ends (`main`'s `Destroyed` event
/// calls `exit`). With it on, the dashboard hides, the chip appears, and the
/// tray icon is the backstop.
///
/// The flyout's *other* exit — the user clicking somewhere else entirely — is
/// not an event on this window at all; see [`flyout::watch_for_click_away`] for
/// why it cannot be.
///
/// This lives on the window rather than in the run loop so it applies on every
/// platform, and so the decision sits next to the functions it chooses between.
fn watch_main_window(app: &AppHandle) {
    let Some(main) = app.get_webview_window(MAIN_LABEL) else {
        log::warn!("[background] no main window to guard");
        return;
    };
    let handle = app.clone();
    main.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if !crate::widget::is_enabled(&handle) {
                return;
            }
            api.prevent_close();

            // Deferred, not done inline. This callback runs while the event
            // loop is dispatching, and hiding the dashboard can end with the
            // widget window being *built* — re-entering window creation from
            // inside an event handler is the one thing to avoid here. A tick's
            // delay is invisible; the window is already committed to going
            // away.
            let handle = handle.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                if let Err(e) = hide_main(&handle) {
                    log::warn!("[background] hide on close failed: {e}");
                }
            });
        }
        _ => {}
    });
}
