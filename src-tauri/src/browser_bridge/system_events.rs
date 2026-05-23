//! OS power events — invalidate bridge state on system resume.

use std::cell::RefCell;
use std::sync::Arc;

use tauri::AppHandle;

use crate::browser_detector::{
    emit_browsers_to_ui, DetectedBrowsersState, ExtensionInstalledState,
    ReconnectingBrowsersState,
};
use crate::browser_tabs::BrowserSlotsMap;

use super::handler::invalidate_slots_on_resume;

struct PowerResumeState {
    slots: BrowserSlotsMap,
    reconnecting: ReconnectingBrowsersState,
    detected: DetectedBrowsersState,
    ext_store: ExtensionInstalledState,
    app: AppHandle,
}

thread_local! {
    static POWER_STATE: RefCell<Option<Arc<PowerResumeState>>> = const { RefCell::new(None) };
}

pub fn spawn_power_listener(
    browser_slots: BrowserSlotsMap,
    reconnecting: ReconnectingBrowsersState,
    detected_browsers: DetectedBrowsersState,
    ext_store: ExtensionInstalledState,
    app: AppHandle,
) {
    std::thread::Builder::new()
        .name("power-events".into())
        .spawn(move || {
            use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
            use windows::Win32::UI::WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW,
                RegisterClassW, TranslateMessage, WM_POWERBROADCAST, WNDCLASSW,
                CS_HREDRAW, CS_VREDRAW, HWND_MESSAGE, WINDOW_EX_STYLE, WINDOW_STYLE,
            };

            const PBT_APMRESUMEAUTOMATIC: u32 = 0x12;

            let shared = Arc::new(PowerResumeState {
                slots: browser_slots,
                reconnecting,
                detected: detected_browsers,
                ext_store,
                app,
            });
            POWER_STATE.with(|cell| {
                *cell.borrow_mut() = Some(Arc::clone(&shared));
            });

            unsafe extern "system" fn wnd_proc(
                hwnd: HWND,
                msg: u32,
                wparam: WPARAM,
                lparam: LPARAM,
            ) -> LRESULT {
                let _ = (hwnd, lparam);
                if msg == WM_POWERBROADCAST {
                    let event = wparam.0 as u32;
                    if event == PBT_APMRESUMEAUTOMATIC {
                        POWER_STATE.with(|cell| {
                            if let Some(state) = cell.borrow().as_ref() {
                                invalidate_slots_on_resume(&state.slots, &state.reconnecting);
                                emit_browsers_to_ui(
                                    &state.app,
                                    &state.detected,
                                    &state.slots,
                                    &state.ext_store,
                                    &state.reconnecting,
                                );
                            }
                        });
                    }
                }
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }

            unsafe {
                let class_name = windows::core::w!("PilPodPowerEvents");

                let wc = WNDCLASSW {
                    lpfnWndProc: Some(wnd_proc),
                    lpszClassName: class_name,
                    style: CS_HREDRAW | CS_VREDRAW,
                    ..Default::default()
                };

                if RegisterClassW(&wc) == 0 {
                    eprintln!("[power-events] RegisterClassW failed");
                    return;
                }

                let hwnd = CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    class_name,
                    class_name,
                    WINDOW_STYLE(0),
                    0,
                    0,
                    0,
                    0,
                    Some(HWND_MESSAGE),
                    None,
                    None,
                    None,
                );

                if hwnd.is_err() {
                    eprintln!("[power-events] CreateWindowExW failed");
                    return;
                }

                eprintln!("[power-events] listening for system resume");

                let mut msg = Default::default();
                while GetMessageW(&mut msg, None, 0, 0).into() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        })
        .expect("spawn power-events");
}
