//! PilPod's presence in the Windows notification area.
//!
//! The tray icon is what makes background mode safe. Once the dashboard is
//! hidden, the floating chip is the only thing on screen that can bring it
//! back — and the chip is small, movable and easy to lose behind a maximized
//! window. The tray gives the running process a fixed, findable home (in the
//! flyout that holds the icons Windows has collapsed) and the one command that
//! can never be reached from a hidden window: quit.
//!
//! It is created once at startup and lives for the whole session, whether or
//! not the widget is ever turned on. An icon that came and went with background
//! mode would be worse than either: users learn where an icon *is*, not where
//! it sometimes is.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
// `Manager` is what puts `app_handle()` on the tray icon inside the event
// callback — the only handle available there.
use tauri::{AppHandle, Manager};

const OPEN_ID: &str = "pilpod://open";
const QUIT_ID: &str = "pilpod://quit";

pub fn init(app: &AppHandle) -> Result<(), String> {
    let open = MenuItem::with_id(app, OPEN_ID, "Open PilPod", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let separator = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit PilPod", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let menu =
        Menu::with_items(app, &[&open, &separator, &quit]).map_err(|e| e.to_string())?;

    TrayIconBuilder::with_id("pilpod")
        .icon(tauri::include_image!("icons/icon.ico"))
        .tooltip("PilPod")
        .menu(&menu)
        // Left click opens the app; the menu is the right-click gesture, which
        // is what every other tray icon on the system does.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN_ID => {
                if let Err(e) = super::show_main(app) {
                    log::warn!("[tray] open failed: {e}");
                }
            }
            QUIT_ID => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Button *up*, not down: acting on the press would fire while the
            // user is still deciding, and a double click would open twice.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(e) = super::show_main(tray.app_handle()) {
                    log::warn!("[tray] open failed: {e}");
                }
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Quit for real, from a state where there may be no window to close.
///
/// `exit` rather than closing `main`: with the widget on, `main`'s close is
/// intercepted and turned into a hide, so asking the window to close would put
/// the app *further* into the background instead of ending it. The icon itself
/// needs no cleanup — the shell drops it when the process goes.
fn quit_app(app: &AppHandle) {
    app.exit(0);
}
