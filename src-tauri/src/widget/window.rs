//! Creation, placement and teardown of the widget's **own** OS window.
//!
//! ## The change this file encodes
//!
//! The widget used to be the main window shrunk to 50×50: entering widget mode
//! resized `main`, leaving it restored the saved bounds. That coupling is why
//! the widget behaved like an attachment of the app — it *was* the app, and
//! anything that happened to the main window (minimize, restore, focus, the
//! taskbar entry) happened to the widget too.
//!
//! Now the widget is a separate top-level `WebviewWindow` labelled `widget`,
//! with `skip_taskbar` set and no parent/owner relationship to `main`. The two
//! windows are siblings, so minimizing, restoring or closing the dashboard has
//! no effect on the widget whatsoever. The widget appears when the user
//! toggles it on and disappears when they toggle it off — nothing else moves
//! it.
//!
//! ## Placement
//!
//! All geometry decisions live in [`super::geometry`] as pure functions. This
//! file's job is only to resolve the *inputs* (which monitor, what physical
//! size, what scale factor) and apply the result. Every position we set is
//! recorded first, so the `Moved` event it provokes is not mistaken for the
//! user dragging — see [`WidgetStore::is_user_move`](super::state::WidgetStore::is_user_move).

use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use super::geometry::{self, Rect};
use super::model::{
    WidgetPlacement, PANEL_LOGICAL_H, PANEL_LOGICAL_H_WITH_BROWSERS, PANEL_LOGICAL_W,
};
use super::state::WidgetStore;

pub const WIDGET_LABEL: &str = "widget";

/// Resolve the widget document. In dev this is the Vite server plus the
/// widget entry; in a bundle it is the second Rollup output. Either way the
/// widget loads *only* its own chunk — the dashboard bundle is never parsed in
/// this window.
fn widget_url(app: &AppHandle) -> WebviewUrl {
    crate::frontend::url(app, "widget.html")
}

pub fn find(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WIDGET_LABEL)
}

fn to_rect(monitor: &tauri::Monitor) -> Rect {
    let wa = monitor.work_area();
    Rect {
        x: wa.position.x,
        y: wa.position.y,
        w: wa.size.width as i32,
        h: wa.size.height as i32,
    }
}

/// Every work area currently available, in physical pixels.
fn work_areas(window: &WebviewWindow) -> Vec<Rect> {
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(to_rect)
        .collect()
}

/// The work area a corner-placed widget should snap to: whichever screen the
/// widget is already on, so dragging it to a second monitor and *then* picking
/// a corner pins it on that monitor rather than yanking it back to the primary.
fn corner_work_area(window: &WebviewWindow) -> Option<Rect> {
    window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .as_ref()
        .map(to_rect)
        .or_else(|| work_areas(window).first().copied())
}

/// Size the widget window for its current mode and move it to the position its
/// placement implies. This is the one function that puts the widget somewhere;
/// creation, placement changes, expand/collapse and DPI changes all funnel
/// through it so there is exactly one geometry code path to reason about.
pub fn apply_layout(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let store = app.state::<WidgetStore>();

    let chip = store.chip_size();
    let (logical_w, logical_h) = if store.is_expanded() {
        let h = if store.browsers_open() {
            PANEL_LOGICAL_H_WITH_BROWSERS
        } else {
            PANEL_LOGICAL_H
        };
        (PANEL_LOGICAL_W, h)
    } else {
        (chip, chip)
    };

    window
        .set_size(LogicalSize::new(logical_w, logical_h))
        .map_err(|e| e.to_string())?;

    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let after = window.outer_size().map_err(|e| e.to_string())?;
    let win_w = after.width as i32;
    let win_h = after.height as i32;

    let (x, y) = match store.placement() {
        WidgetPlacement::Corner { corner } => {
            let area =
                corner_work_area(window).ok_or_else(|| "no monitor available".to_string())?;
            geometry::corner_position(area, win_w, win_h, corner)
        }
        WidgetPlacement::Free { x, y } => {
            // `x`/`y` are always the *chip's* logical top-left, never the
            // panel's. Expanding therefore grows inward from the screen corner
            // the chip is nearest to, and collapsing lands the chip back
            // exactly where the user left it.
            let chip_x = (x * scale).round() as i32;
            let chip_y = (y * scale).round() as i32;
            let chip_w = (chip * scale).round() as i32;
            let chip_h = chip_w;

            let areas = work_areas(window);
            let area = geometry::work_area_for(&areas, chip_x, chip_y, chip_w, chip_h)
                .copied()
                .or_else(|| corner_work_area(window))
                .ok_or_else(|| "no monitor available".to_string())?;

            let anchor = geometry::nearest_corner(area, chip_x, chip_y, chip_w, chip_h);
            let (ax, ay) =
                geometry::anchored_resize(chip_x, chip_y, chip_w, chip_h, win_w, win_h, anchor);
            // A monitor can be unplugged between sessions; never restore the
            // widget somewhere the user cannot reach it.
            geometry::clamp_into(area, ax, ay, win_w, win_h)
        }
    };

    // Remember where we put it *before* moving, so the `Moved` event this
    // triggers — which Windows delivers later, off the message queue — is
    // recognised as ours rather than mistaken for a drag.
    store.note_applied_position(x, y);
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// The widget's current logical top-left, if it is on screen.
///
/// Used to seed free placement so "Free" releases the widget exactly where it
/// is standing rather than teleporting it to the origin. The caller falls back
/// to the stored value when the widget is off.
pub fn current_logical_position(app: &AppHandle) -> Option<(f64, f64)> {
    let window = find(app)?;
    let scale = window.scale_factor().ok()?;
    let pos = window.outer_position().ok()?;
    Some((f64::from(pos.x) / scale, f64::from(pos.y) / scale))
}

/// Create the widget window if it does not exist, position it, and show it.
///
/// Built hidden and revealed only after placement lands, so the widget never
/// flashes at the OS default position before snapping to its corner.
pub fn show(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = find(app) {
        apply_layout(app, &window)?;
        window.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let chip = app.state::<WidgetStore>().chip_size();

    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, WIDGET_LABEL, widget_url(app))
        .title("PilPod Widget")
        .inner_size(chip, chip)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible(false)
        .focused(false);

    // Independent, but not a second entry in the user's taskbar or Alt+Tab
    // list — it is an accessory, not a place to switch to. (macOS has no
    // per-window taskbar concept, hence the gate.)
    #[cfg(any(windows, target_os = "linux"))]
    {
        builder = builder.skip_taskbar(true);
    }

    // Every window in the process must request the same WebView2 arguments or
    // environment creation fails — see `inapp_player::agent::BROWSER_ARGS`.
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args(crate::inapp_player::agent::BROWSER_ARGS);
    }

    let window = builder.build().map_err(|e| e.to_string())?;
    attach_event_handlers(app, &window);

    apply_layout(app, &window)?;
    window.show().map_err(|e| e.to_string())?;
    Ok(())
}

/// Tear the widget window down.
///
/// Destroying rather than hiding is deliberate: a hidden webview keeps its
/// renderer process and its event subscriptions alive, and the widget is a
/// feature most users leave off. Recreating it costs a few hundred
/// milliseconds once; keeping it costs memory for the whole session.
///
/// `destroy` rather than `close`, because `close` only *requests* a close —
/// the window survives until the event loop gets to it, and a quick off/on
/// toggle would then find the dying window and try to reuse it.
pub fn destroy(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = find(app) {
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reconcile the OS window with `enabled`, then re-place it.
pub fn sync(app: &AppHandle) -> Result<(), String> {
    let enabled = app.state::<WidgetStore>().is_enabled();
    if enabled {
        show(app)
    } else {
        destroy(app)
    }
}

/// Re-place an already-visible widget (placement change, expand/collapse, DPI
/// change). No-op when the widget is off.
pub fn relayout(app: &AppHandle) -> Result<(), String> {
    match find(app) {
        Some(window) => apply_layout(app, &window),
        None => Ok(()),
    }
}

fn attach_event_handlers(app: &AppHandle, window: &WebviewWindow) {
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        // Record where the user dragged the widget to.
        //
        // Three things are deliberately not recorded:
        //   * corner mode — a pinned widget has no free position to remember,
        //     and storing one would silently convert the mode on relayout;
        //   * while expanded — the reported position is the *panel's*, and the
        //     stored value must always describe the chip;
        //   * our own moves — see `WidgetStore::is_user_move`.
        WindowEvent::Moved(position) => {
            let store = handle.state::<WidgetStore>();
            if store.is_expanded()
                || !store.placement().is_free()
                || !store.is_user_move(position.x, position.y)
            {
                return;
            }
            let Some(window) = find(&handle) else { return };
            let Ok(scale) = window.scale_factor() else {
                return;
            };
            let x = f64::from(position.x) / scale;
            let y = f64::from(position.y) / scale;
            if let Some(state) = store.mutate(|s| s.placement = WidgetPlacement::Free { x, y }) {
                super::state::commit(&handle, &store, state);
            }
        }
        // Dragging onto a monitor with a different DPI changes the physical
        // size out from under us; re-run placement so a pinned corner stays
        // flush instead of drifting by the scale delta.
        WindowEvent::ScaleFactorChanged { .. } => {
            let handle = handle.clone();
            // Tauri delivers this from the event loop; defer so the resize has
            // settled before we measure it.
            tauri::async_runtime::spawn(async move {
                let _ = relayout(&handle);
            });
        }
        _ => {}
    });
}
