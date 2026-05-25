//! No-focus browser launch (Windows only). Exe resolution lives in `browser_catalog`.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

use windows::core::PCWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Threading::{
    CreateProcessW, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW, STARTF_USESHOWWINDOW,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE;

pub fn resolve_exe_path(os_browser_id: &str) -> Option<String> {
    crate::browser_catalog::resolve_exe_path(os_browser_id)
}

pub fn launch_no_focus(exe_path: &str) -> Result<(), String> {
    let wide: Vec<u16> = OsStr::new(exe_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let si = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        dwFlags: STARTF_USESHOWWINDOW,
        wShowWindow: SW_SHOWNOACTIVATE.0 as u16,
        ..Default::default()
    };

    let mut pi = PROCESS_INFORMATION::default();

    unsafe {
        CreateProcessW(
            PCWSTR(wide.as_ptr()),
            None,
            None,
            None,
            false,
            PROCESS_CREATION_FLAGS(0),
            None,
            None,
            &si,
            &mut pi,
        )
        .map_err(|e| format!("CreateProcessW failed: {e}"))?;

        let _ = CloseHandle(pi.hProcess);
        let _ = CloseHandle(pi.hThread);
    }

    Ok(())
}
