//! The dashboard behaving as a flyout: where it opens, and when it goes away.
//!
//! Both halves exist to make one claim true — with the widget on, PilPod is not
//! a window you manage, it is a panel you glance at. A panel opens where you
//! clicked and closes when you look away; anything else and the user is back to
//! doing window management on something the size of a coaster.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, PhysicalPosition, WebviewWindow};

/// Move the dashboard so it unfolds from the chip.
///
/// Best-effort by design: if there is no chip to measure — the widget window
/// has not been built yet, or a monitor vanished — the window opens wherever it
/// already was, which is strictly better than guessing a corner and yanking it
/// across the screen.
///
/// Must be called while the chip is still *placed* (hidden is fine, destroyed
/// is not), so the caller measures before it hides it.
pub fn anchor_to_chip(app: &AppHandle, main: &WebviewWindow) {
    let Ok(size) = main.outer_size() else { return };
    let Some((x, y)) =
        crate::widget::anchor_from_chip(app, size.width as i32, size.height as i32)
    else {
        return;
    };
    if let Err(e) = main.set_position(PhysicalPosition::new(x, y)) {
        log::warn!("[flyout] placement failed: {e}");
    }
}

/// Grace period after the flyout appears, before click-away can dismiss it.
///
/// Covers the window actually arriving: the chip standing down, the position
/// being applied, the webview taking keyboard focus. Windows can report the
/// foreground as somewhere else entirely for a beat in the middle of that.
const GRACE: Duration = Duration::from_millis(450);

/// How often to ask where the user's attention is, once the flyout is up.
const POLL: Duration = Duration::from_millis(120);

/// Consecutive "not ours" readings before dismissing. Two at `POLL` apart is
/// still under a quarter second — fast enough to feel like a menu closing,
/// slow enough to ride out a single-frame foreground blip.
const STRIKES: u8 = 2;

/// Only the newest watcher acts; a fresh `show_main` retires the previous one.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Watch for the user's attention leaving PilPod, and dismiss the flyout when
/// it does. Started by `show_main`; stops on its own once the flyout is gone.
///
/// ## Why this polls instead of listening for blur
///
/// It used to listen for the window's `Focused(false)`. That misses the case
/// this feature is most likely to hit: a flyout the user *never interacted
/// with*. Open it, read what is playing, click back into the browser — the
/// window may never have taken keyboard focus at all, so it never blurs, so
/// nothing fires and the panel just sits there until you click it once to
/// "arm" it. Asking a question every frame-and-a-bit has no such gap, and the
/// question is cheap.
///
/// ## What counts as leaving
///
/// The *foreground window*, at process granularity — not our window's focus
/// flag. Three things take focus off the dashboard without the user having
/// gone anywhere: a native file dialog (the wallpaper picker, a vault
/// backup), PilPod's own player window, and the chip itself while its settings
/// this process, so none of them dismiss.
pub fn watch_for_click_away(app: &AppHandle) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(GRACE);
        let mut strikes = 0u8;
        loop {
            // Superseded by a newer watcher — that one owns the flyout now.
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            // The flyout is already gone, or stopped being a flyout: the widget
            // was switched off, the window was closed, PilPod is quitting.
            if !crate::widget::is_enabled(&app) || !super::main_is_visible(&app) {
                return;
            }

            if foreground_is_ours(&app) {
                strikes = 0;
            } else {
                strikes += 1;
                if strikes >= STRIKES {
                    if let Err(e) = super::hide_main(&app) {
                        log::warn!("[flyout] dismiss failed: {e}");
                    }
                    return;
                }
            }
            std::thread::sleep(POLL);
        }
    });
}

/// Does the window the user is actually looking at belong to PilPod?
#[cfg(windows)]
fn foreground_is_ours(_app: &AppHandle) -> bool {
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    // Asked at the process level rather than per-window: native dialogs are
    // ours but are not Tauri windows, and they are exactly the case a
    // per-window check would get wrong.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return false;
        }
        let mut pid = 0u32;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        pid != 0 && pid == GetCurrentProcessId()
    }
}

/// Portable fallback: the best we can ask without a platform API is whether any
/// window of ours still holds focus. Misses native dialogs, which is why
/// Windows — the platform PilPod ships on — does not use this path.
#[cfg(not(windows))]
fn foreground_is_ours(app: &AppHandle) -> bool {
    use tauri::Manager;
    app.webview_windows()
        .values()
        .any(|w| w.is_focused().unwrap_or(false))
}
