//! The widget's IPC surface.
//!
//! Six commands, one shape: mutate the store, reconcile the OS window,
//! broadcast the new state. Both webviews (dashboard menu and widget) call the
//! same commands and both re-render from the same `widget://state` event, so
//! "pick a corner in the menu and watch the widget move" needs no extra
//! plumbing — it falls out of having a single writer.
//!
//! Every command that can touch window creation is `async` and hops onto a
//! blocking thread first: building or resizing a window from the WebView
//! thread deadlocks on Windows.

use tauri::{AppHandle, Manager, State};

use super::model::{WidgetPlacement, WidgetState};
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

/// Turn the floating widget on or off.
///
/// On is immediate and unconditional — the widget appears now, whether or not
/// the dashboard is open, focused or minimized. That independence is the whole
/// point of the widget living in its own window.
#[tauri::command]
pub async fn widget_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let next = {
        let store = app.state::<WidgetStore>();
        let changed = store.mutate(|s| s.enabled = enabled);
        // Collapse on the way out so the next toggle-on shows a chip, not a
        // stale panel. The broadcast below carries the collapsed flag, so the
        // returned state here is deliberately dropped.
        if !enabled {
            let _ = store.set_expanded(false);
        }
        changed
    };

    off_webview_thread(app.clone(), window::sync).await?;

    if let Some(mut s) = next {
        s.expanded = app.state::<WidgetStore>().is_expanded();
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

/// Expand the widget into the media panel, or collapse it back to the chip.
///
/// The window resizes around the corner it is anchored to, so the panel
/// unfolds from the chip instead of jumping.
#[tauri::command]
pub async fn widget_set_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    let next = app.state::<WidgetStore>().set_expanded(expanded);
    if next.is_none() {
        return Ok(());
    }

    off_webview_thread(app.clone(), window::relayout).await?;

    if let Some(s) = next {
        // Live-only flag: broadcast, but nothing to persist.
        state::emit_state(&app, s);
    }
    Ok(())
}

/// Bring the dashboard back to the front from the widget.
///
/// Restores first: the main window may be minimized, and `set_focus` alone
/// does not un-minimize on Windows. The widget is untouched — going back to
/// the full window does not dismiss it.
#[tauri::command]
pub async fn widget_open_main(app: AppHandle) -> Result<(), String> {
    off_webview_thread(app, |app: &AppHandle| {
        let Some(main) = app.get_webview_window("main") else {
            return Err("main window not found".to_string());
        };
        if main.is_minimized().unwrap_or(false) {
            main.unminimize().map_err(|e| e.to_string())?;
        }
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

/// Re-run placement. Cheap escape hatch for the widget window to call once its
/// content has laid out, and for recovering from a monitor topology change.
#[tauri::command]
pub async fn widget_relayout(app: AppHandle) -> Result<(), String> {
    off_webview_thread(app, window::relayout).await
}
