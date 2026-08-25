//! The widget's IPC surface.
//!
//! Every command has the same shape: mutate the store, reconcile the OS
//! window, broadcast the new state. Both webviews (dashboard menu and widget)
//! call the same commands and both re-render from the same `widget://state`
//! event, so "pick a corner, a colour or a size in the menu and watch the
//! widget change" needs no extra plumbing — it falls out of having a single
//! writer.
//!
//! Every command that can touch window creation is `async` and hops onto a
//! blocking thread first: building or resizing a window from the WebView
//! thread deadlocks on Windows.

use tauri::{AppHandle, Manager, State};

use super::model::{WidgetAccent, WidgetPlacement, WidgetState};
use super::state::{self, WidgetStore};
use super::window;

/// Run `f` off the WebView thread and flatten the join error.
async fn off_webview_thread<F>(app: AppHandle, f: F) -> Result<(), String>
where
    F: FnOnce(&AppHandle) -> Result<(), String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(&app))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

/// Current widget state. Called once per window on mount; live updates arrive
/// via the `widget://state` event.
#[tauri::command]
pub fn widget_get_state(store: State<'_, WidgetStore>) -> WidgetState {
    store.state()
}

/// Turn the floating widget on or off — which is also what decides whether the
/// dashboard is a window or a flyout.
///
/// Turning it **on** does not put PilPod away. It converts the dashboard in
/// place: out of the taskbar, and from now on dismissed by clicking elsewhere
/// rather than only by closing. The window itself stays exactly where it is
/// until the user's attention moves, at which point the chip takes over. Hiding
/// it here — which is what this used to do — made pressing a settings toggle
/// look like the app quitting.
///
/// Turning it **off** is the reverse, and can only really be asked for from the
/// dashboard, which is by definition already on screen. Showing it anyway keeps
/// the invariant true from every caller: with the widget off, the dashboard is
/// the app, so it must be visible — and `show_main` is also what hands back the
/// taskbar button.
#[tauri::command]
pub async fn widget_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let next = app.state::<WidgetStore>().mutate(|s| s.enabled = enabled);

    off_webview_thread(app.clone(), move |app: &AppHandle| {
        if enabled {
            crate::background::enter_flyout_mode(app)
        } else {
            // `show_main` reconciles the chip on its way out, and by now the
            // widget reads as disabled — so that same call is what tears the
            // chip's window down for good.
            crate::background::show_main(app)
        }
    })
    .await?;

    if let Some(s) = next {
        state::commit(&app, &app.state::<WidgetStore>(), s);
    }
    Ok(())
}

/// Move the widget: free-floating, or pinned flush to a screen corner.
///
/// Applied to the live window immediately, which is what makes the menu's
/// corner buttons a real-time preview rather than a setting you have to
/// confirm.
#[tauri::command]
pub async fn widget_set_placement(
    app: AppHandle,
    placement: WidgetPlacement,
) -> Result<(), String> {
    let next = app
        .state::<WidgetStore>()
        .mutate(|s| s.placement = placement);

    off_webview_thread(app.clone(), window::relayout).await?;

    if let Some(s) = next {
        state::commit(&app, &app.state::<WidgetStore>(), s);
    }
    Ok(())
}

/// Switch to free placement without moving the widget.
///
/// Seeds the stored position from where the widget is standing right now, so
/// unpinning from a corner releases it in place. Measured natively rather than
/// in the menu's webview, which can only see the *dashboard* window's
/// geometry — a subtle way to end up dropping the widget in the wrong spot.
#[tauri::command]
pub async fn widget_use_free_placement(app: AppHandle) -> Result<(), String> {
    let seed = window::current_logical_position(&app);
    let next = {
        let store = app.state::<WidgetStore>();
        let fallback = match store.placement() {
            WidgetPlacement::Free { x, y } => (x, y),
            WidgetPlacement::Corner { .. } => (0.0, 0.0),
        };
        let (x, y) = seed.unwrap_or(fallback);
        store.mutate(|s| s.placement = WidgetPlacement::Free { x, y })
    };

    off_webview_thread(app.clone(), window::relayout).await?;

    if let Some(s) = next {
        state::commit(&app, &app.state::<WidgetStore>(), s);
    }
    Ok(())
}

/// Recolour the triangle. Purely cosmetic; no geometry changes.
#[tauri::command]
pub fn widget_set_accent(app: AppHandle, accent: WidgetAccent) -> Result<(), String> {
    let store = app.state::<WidgetStore>();
    if let Some(s) = store.mutate(|c| c.accent = accent) {
        state::commit(&app, &store, s);
    }
    Ok(())
}

/// Resize the chip.
///
/// The window *is* the chip, so this resizes the window too — which is why it
/// has to relayout: a corner-pinned widget must stay flush as it grows, and
/// growing a bottom-right chip without re-placing it would push it off screen.
///
/// Writes to whichever of the two sizes the current placement uses (see
/// [`super::model::WidgetSettings::set_active_size`]), so the one slider on screen
/// always edits the shape on screen.
#[tauri::command]
pub async fn widget_set_size(app: AppHandle, size: f64) -> Result<(), String> {
    let next = app
        .state::<WidgetStore>()
        .mutate(|s| s.set_active_size(size));
    if next.is_none() {
        return Ok(());
    }

    off_webview_thread(app.clone(), window::relayout).await?;

    if let Some(s) = next {
        state::commit(&app, &app.state::<WidgetStore>(), s);
    }
    Ok(())
}

/// Bring the dashboard back — the chip's one job.
///
/// The widget stays *enabled* throughout; it is only taken off screen, so
/// closing the dashboard again brings it straight back. Nothing here changes a
/// setting, which is why it emits no state: from the frontend's point of view
/// the widget is still on.
#[tauri::command]
pub async fn widget_open_main(app: AppHandle) -> Result<(), String> {
    off_webview_thread(app, crate::background::show_main).await
}

/// Hold the chip on screen while its settings panel is open, then let it go.
///
/// Normally the chip yields to the dashboard — one surface at a time. This is
/// the one exception, and it exists because a corner picker, a colour picker
/// and a size slider are all describing something the user would otherwise not
/// be able to see while they used them.
///
/// Live-only and deliberately silent: nothing in either webview renders
/// differently, so there is no state to broadcast. Only the native side cares.
#[tauri::command]
pub async fn widget_set_preview(app: AppHandle, preview: bool) -> Result<(), String> {
    if !app.state::<WidgetStore>().set_preview(preview) {
        return Ok(());
    }
    off_webview_thread(app, window::sync).await
}

/// Send the dashboard away without turning anything off.
///
/// This is what the header's minimize button means once the widget is on: the
/// tooltip has always said "minimize to floating widget", and now it does that
/// instead of leaving a taskbar button for a window the chip already stands in
/// for. With the widget off the frontend minimizes normally and never calls
/// this.
#[tauri::command]
pub async fn widget_hide_main(app: AppHandle) -> Result<(), String> {
    off_webview_thread(app, crate::background::hide_main).await
}

/// Re-run placement. Cheap escape hatch for the widget window to call once its
/// content has laid out, and for recovering from a monitor topology change.
#[tauri::command]
pub async fn widget_relayout(app: AppHandle) -> Result<(), String> {
    off_webview_thread(app, window::relayout).await
}
