//! Native rounded corners for PilPod's undecorated windows (Windows only).
//!
//! Every PilPod window is `decorations: false` + `transparent: true` and draws
//! its own rounded rim in CSS. That only looks right if the OS also clips the
//! window to the same curve: if the window rect stays a sharp rectangle, the
//! area between the CSS radius and the rectangle corner is whatever the
//! WebView2 surface happens to composite there — in a bundled build that is
//! opaque black, which reads as "the app sits inside a black box".
//!
//! `DWMWA_WINDOW_CORNER_PREFERENCE` (Windows 11, build 22000+) makes DWM clip
//! the window itself, so nothing can leak past the corner regardless of how the
//! webview composites. Keep `--pilpod-screen-radius` in `src/index.css` at or
//! below [`OS_CORNER_RADIUS_PX`] so the CSS rim never bulges outside that clip.
//!
//! On Windows 10 the attribute does not exist and the call fails harmlessly;
//! the window keeps square corners, which is the pre-existing behaviour.

use std::ffi::c_void;

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    DWM_WINDOW_CORNER_PREFERENCE,
};

/// Radius DWM uses for `DWMWCP_ROUND`. Mirrored by `--pilpod-screen-radius`.
pub const OS_CORNER_RADIUS_PX: i32 = 8;

/// `DWMWA_COLOR_NONE` from `dwmapi.h` — suppresses the border entirely. The
/// `windows` crate does not re-export the sentinel, only the attribute.
const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

/// Anything Tauri hands us that owns an OS window. `Window` and `WebviewWindow`
/// both expose `hwnd()` as an inherent method with no shared trait between
/// them, so this bridges the two.
pub trait HasHwnd {
    fn os_handle(&self) -> Option<HWND>;
}

impl HasHwnd for tauri::WebviewWindow {
    fn os_handle(&self) -> Option<HWND> {
        self.hwnd().ok()
    }
}

impl HasHwnd for tauri::Window {
    fn os_handle(&self) -> Option<HWND> {
        self.hwnd().ok()
    }
}

/// Ask the OS to clip `window` to rounded corners.
///
/// Best-effort: a failure here is cosmetic, never fatal, so it is logged and
/// swallowed rather than propagated into window creation.
pub fn apply(window: &impl HasHwnd) {
    let Some(hwnd) = window.os_handle() else {
        eprintln!("[pilpod] rounded corners: window has no HWND");
        return;
    };

    let preference: DWM_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND;
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const DWM_WINDOW_CORNER_PREFERENCE as *const c_void,
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        )
    };

    // Expected on Windows 10 (attribute unsupported) — not worth failing over.
    if let Err(e) = result {
        eprintln!("[pilpod] rounded corners unavailable: {e}");
    }

    // Rounding opts the window into DWM's frame, which paints a 1px border in
    // the system accent/contrast colour. PilPod draws its own rim in CSS, so
    // that border reads as a stray outline hugging the screen edge.
    let border = DWMWA_COLOR_NONE;
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &border as *const u32 as *const c_void,
            std::mem::size_of::<u32>() as u32,
        )
    };

    if let Err(e) = result {
        eprintln!("[pilpod] window border colour unavailable: {e}");
    }
}
