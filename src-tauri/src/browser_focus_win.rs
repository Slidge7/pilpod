//! Bring a Chromium / Firefox top-level window to the foreground using Win32.
//! Chromium extensions often cannot satisfy Windows foreground rules after an async
//! delay, so we locate the frame HWND by class + caption and call SetForegroundWindow.

use std::thread;
use std::time::Duration;

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, TRUE};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongW,
    GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    SetForegroundWindow, ShowWindow, GA_ROOT, GWL_STYLE, GW_OWNER, SW_RESTORE, WS_CHILD,
};

struct EnumCtx {
    tab_title: String,
    browser_hint: String,
    best_score: i32,
    best_hwnd: HWND,
}

fn browser_frame_class_ok(class: &str) -> bool {
    matches!(class.trim(), "Chrome_WidgetWin_1" | "MozillaWindowClass")
}

fn browser_hint_matches_caption(caption: &str, hint: &str) -> bool {
    let h = hint.trim().to_lowercase();
    match h.as_str() {
        "" | "unknown" => true,
        "edge" => caption.contains("Microsoft Edge") || caption.contains(" - Edge"),
        "chrome" | "chromium" => {
            caption.contains("Google Chrome") || caption.contains("Chromium")
        }
        "brave" => caption.contains("Brave"),
        "opera" => caption.contains("Opera"),
        "vivaldi" => caption.contains("Vivaldi"),
        "arc" => caption.contains("Arc"),
        "firefox" => caption.contains("Firefox") || caption.contains("Mozilla"),
        "safari" => caption.contains("Safari"),
        _ => true,
    }
}

fn score_match(caption: &str, tab_title: &str, browser_hint: &str) -> i32 {
    if caption.is_empty() {
        return -1;
    }
    let tab = tab_title.trim();
    let hint = browser_hint.trim();
    let mut score: i32 = 0;

    if !tab.is_empty() {
        if caption.starts_with(tab) {
            score += 120;
        } else if caption.contains(tab) {
            score += 70;
        } else {
            return -1;
        }
    } else if hint.is_empty() || hint.eq_ignore_ascii_case("unknown") {
        return -1;
    } else if !browser_hint_matches_caption(caption, hint) {
        return -1;
    } else {
        score += 20;
    }

    if !hint.is_empty() && !hint.eq_ignore_ascii_case("unknown") {
        if browser_hint_matches_caption(caption, hint) {
            score += 35;
        } else {
            score -= 45;
        }
    }

    score
}

unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut EnumCtx);

    if !IsWindowVisible(hwnd).as_bool() {
        return TRUE;
    }

    if GetAncestor(hwnd, GA_ROOT) != hwnd {
        return TRUE;
    }

    let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
    if (style & WS_CHILD.0) != 0 {
        return TRUE;
    }

    let owner = unsafe { GetWindow(hwnd, GW_OWNER) };
    if let Ok(o) = owner {
        if !o.is_invalid() {
            return TRUE;
        }
    }

    let mut class = [0u16; 256];
    let n = GetClassNameW(hwnd, &mut class);
    if n == 0 {
        return TRUE;
    }
    let class_name = String::from_utf16_lossy(&class[..n as usize]);
    if !browser_frame_class_ok(&class_name) {
        return TRUE;
    }

    let len = GetWindowTextLengthW(hwnd);
    if len <= 0 {
        return TRUE;
    }
    let mut buf = vec![0u16; len as usize + 1];
    let got = GetWindowTextW(hwnd, &mut buf);
    if got == 0 {
        return TRUE;
    }
    let caption = String::from_utf16_lossy(&buf[..got as usize]);

    let s = score_match(&caption, &ctx.tab_title, &ctx.browser_hint);
    if s > ctx.best_score {
        ctx.best_score = s;
        ctx.best_hwnd = hwnd;
    }

    TRUE
}

unsafe fn bring_window_to_foreground(hwnd: HWND) {
    let _ = ShowWindow(hwnd, SW_RESTORE);

    let fg = GetForegroundWindow();
    if fg.is_invalid() || fg == hwnd {
        let _ = SetForegroundWindow(hwnd);
        return;
    }

    let fg_tid = GetWindowThreadProcessId(fg, None);
    let cur_tid = GetCurrentThreadId();
    if fg_tid != 0 && AttachThreadInput(cur_tid, fg_tid, true).as_bool() {
        let _ = SetForegroundWindow(hwnd);
        let _ = AttachThreadInput(cur_tid, fg_tid, false);
    } else {
        let _ = SetForegroundWindow(hwnd);
    }
}

/// Runs after `focusTab` is queued so the extension can update the active tab caption.
pub fn spawn_raise_browser_window(tab_title: String, browser_window_hint: String) {
    thread::spawn(move || {
        for attempt in 0u32..8 {
            if attempt == 0 {
                thread::sleep(Duration::from_millis(160));
            } else {
                thread::sleep(Duration::from_millis(100));
            }

            let mut ctx = EnumCtx {
                tab_title: tab_title.clone(),
                browser_hint: browser_window_hint.clone(),
                best_score: -1,
                best_hwnd: HWND::default(),
            };

            let lparam = LPARAM(&mut ctx as *mut EnumCtx as isize);
            unsafe {
                let _ = EnumWindows(Some(enum_windows_proc), lparam);
            }

            if ctx.best_score >= 0 && !ctx.best_hwnd.is_invalid() {
                unsafe {
                    bring_window_to_foreground(ctx.best_hwnd);
                }
                return;
            }
        }
    });
}
