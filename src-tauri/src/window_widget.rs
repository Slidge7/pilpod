//! Phone / floating-widget window geometry (Windows). Uses Tauri window APIs only.

use std::sync::Mutex;

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State};

const PHONE_W: f64 = 350.0;
const PHONE_H: f64 = 600.0;
const WIDGET_PX: u32 = 50;
const CORNER_MARGIN_PX: i32 = 12;
/// Gap between the bottom edge of the restored window and the top of the widget slot (px).
const ABOVE_WIDGET_GAP_PX: i32 = 0;

#[derive(Default)]
pub struct RestoreBounds(
    pub Mutex<Option<(LogicalSize<f64>, LogicalPosition<f64>)>>,
);

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())
}

#[tauri::command]
pub fn toggle_widget_mode(
    app: AppHandle,
    state: State<'_, RestoreBounds>,
    is_mini: bool,
) -> Result<(), String> {
    let window = main_window(&app)?;

    if is_mini {
        let sf = window.scale_factor().map_err(|e| e.to_string())?;
        let outer_size = window.outer_size().map_err(|e| e.to_string())?;
        let outer_pos = window.outer_position().map_err(|e| e.to_string())?;

        let logical_size = LogicalSize::new(
            f64::from(outer_size.width) / sf,
            f64::from(outer_size.height) / sf,
        );
        let logical_pos = LogicalPosition::new(
            f64::from(outer_pos.x) / sf,
            f64::from(outer_pos.y) / sf,
        );

        if let Ok(mut g) = state.0.lock() {
            *g = Some((logical_size, logical_pos));
        }

        window.set_resizable(false).map_err(|e| e.to_string())?;
        window
            .set_always_on_top(true)
            .map_err(|e| e.to_string())?;

        let mon = window
            .current_monitor()
            .map_err(|e| e.to_string())?
            .or_else(|| window.primary_monitor().ok().flatten())
            .ok_or_else(|| "no monitor".to_string())?;

        let wa = mon.work_area();
        let wx = wa.position.x;
        let wy = wa.position.y;
        let ww = wa.size.width as i32;
        let wh = wa.size.height as i32;
        let w = WIDGET_PX as i32;

        let nx = wx + ww - w - CORNER_MARGIN_PX;
        let ny = wy + wh - w - CORNER_MARGIN_PX;

        window
            .set_position(PhysicalPosition::new(nx, ny))
            .map_err(|e| e.to_string())?;
        window
            .set_size(PhysicalSize::new(WIDGET_PX, WIDGET_PX))
            .map_err(|e| e.to_string())?;
    } else {
        let current_size = window.outer_size().map_err(|e| e.to_string())?;
        let current_pos = window.outer_position().map_err(|e| e.to_string())?;

        let snapshot = state.0.lock().ok().and_then(|g| (*g).clone());

        let logical_size = snapshot
            .as_ref()
            .map(|(s, _)| *s)
            .unwrap_or(LogicalSize::new(PHONE_W, PHONE_H));

        window.set_resizable(true).map_err(|e| e.to_string())?;
        window
            .set_size(logical_size)
            .map_err(|e| e.to_string())?;

        let actual_outer = window.outer_size().map_err(|e| e.to_string())?;

        let is_widget = current_size.width == WIDGET_PX && current_size.height == WIDGET_PX;

        if is_widget {
            let mon = window
                .current_monitor()
                .map_err(|e| e.to_string())?
                .or_else(|| window.primary_monitor().ok().flatten())
                .ok_or_else(|| "no monitor".to_string())?;

            let wa = mon.work_area();
            let min_x = wa.position.x;
            let min_y = wa.position.y;
            let max_x = wa.position.x + wa.size.width as i32;
            let max_y = wa.position.y + wa.size.height as i32;

            let full_w = actual_outer.width as i32;
            let full_h = actual_outer.height as i32;

            let wx = current_pos.x;
            let wy = current_pos.y;
            let widget_w = current_size.width as i32;

            // Stack the phone window directly above the widget: same horizontal center,
            // bottom edge of phone = top of widget minus gap (physical pixels).
            let mut new_x = wx + (widget_w - full_w) / 2;
            let mut new_y = wy - ABOVE_WIDGET_GAP_PX - full_h;

            if new_x < min_x {
                new_x = min_x;
            } else if new_x + full_w > max_x {
                new_x = max_x - full_w;
            }

            if new_y < min_y {
                new_y = min_y;
            } else if new_y + full_h > max_y {
                new_y = max_y - full_h;
            }

            window
                .set_position(PhysicalPosition::new(new_x, new_y))
                .map_err(|e| e.to_string())?;
        } else if let Some((_, pos)) = snapshot {
            window
                .set_position(pos)
                .map_err(|e| e.to_string())?;
        } else {
            let _ = window.center();
        }

        window
            .set_always_on_top(false)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
