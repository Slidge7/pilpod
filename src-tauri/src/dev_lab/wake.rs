//! Registry exe resolution and no-focus browser launch (Windows only).

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use winreg::{enums::*, RegKey};
use windows::core::PCWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    CreateProcessW, OpenProcess, QueryFullProcessImageNameW, PROCESS_CREATION_FLAGS,
    PROCESS_INFORMATION, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, STARTUPINFOW,
    STARTF_USESHOWWINDOW,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE;

/// Maps OS browser id → known registry client names to try (ordered by likelihood).
fn registry_names_for(os_id: &str) -> &'static [&'static str] {
    match os_id {
        "chrome" => &["Google Chrome"],
        "msedge" => &["Microsoft Edge"],
        "firefox" => &["Mozilla Firefox"],
        "brave" => &["Brave", "Brave Browser", "Brave-Browser", "BraveHTML"],
        "opera" => &["Opera Stable", "Opera", "Opera GX Stable", "Opera GX"],
        "vivaldi" => &["Vivaldi"],
        "chromium" => &["Chromium"],
        "arc" => &["Arc"],
        _ => &[],
    }
}

fn exe_name_for(os_id: &str) -> Option<&'static str> {
    match os_id {
        "chrome" => Some("chrome.exe"),
        "msedge" => Some("msedge.exe"),
        "firefox" => Some("firefox.exe"),
        "brave" => Some("brave.exe"),
        "opera" => Some("opera.exe"),
        "vivaldi" => Some("vivaldi.exe"),
        "chromium" => Some("chromium.exe"),
        "arc" => Some("arc.exe"),
        _ => None,
    }
}

fn registry_key_matches_os_id(key_name: &str, os_id: &str) -> bool {
    let lower = key_name.to_lowercase();
    match os_id {
        "chrome" => lower.contains("chrome") && !lower.contains("edge"),
        "msedge" => lower.contains("edge") || lower.contains("msedge"),
        id => lower.contains(id),
    }
}

fn parse_exe_from_command(val: &str) -> String {
    let exe = val.trim().trim_start_matches('"');
    let exe = exe.split('"').next().unwrap_or(exe);
    exe.split(" --").next().unwrap_or(exe).trim().to_string()
}

fn read_exe_from_key(base: &RegKey, name: &str) -> Option<String> {
    let key_path = format!("{name}\\shell\\open\\command");
    let key = base.open_subkey(&key_path).ok()?;
    let val = key.get_value::<String, _>("").ok()?;
    let exe = parse_exe_from_command(&val);
    if exe.is_empty() || !Path::new(&exe).is_file() {
        None
    } else {
        Some(exe)
    }
}

fn resolve_from_start_menu_internet(hive: &RegKey, os_browser_id: &str) -> Option<String> {
    let base = hive
        .open_subkey("SOFTWARE\\Clients\\StartMenuInternet")
        .ok()?;

    for name in registry_names_for(os_browser_id) {
        if let Some(exe) = read_exe_from_key(&base, name) {
            return Some(exe);
        }
    }

    for name in base.enum_keys().flatten() {
        if registry_key_matches_os_id(&name, os_browser_id) {
            if let Some(exe) = read_exe_from_key(&base, &name) {
                return Some(exe);
            }
        }
    }

    None
}

fn resolve_brave_install_path() -> Option<String> {
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let key = RegKey::predef(hive)
            .open_subkey("SOFTWARE\\BraveSoftware\\Brave-Browser")
            .ok()?;
        if let Ok(install) = key.get_value::<String, _>("InstallPath") {
            let exe = Path::new(&install).join("brave.exe");
            if exe.is_file() {
                return Some(exe.to_string_lossy().into_owned());
            }
        }
    }
    None
}

fn resolve_from_running_process(os_browser_id: &str) -> Option<String> {
    let exe_name = exe_name_for(os_browser_id)?;
    let target = exe_name.to_lowercase();

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_err() {
            let _ = CloseHandle(snapshot);
            return None;
        }

        loop {
            let len = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();

            if name == target {
                if let Some(path) = image_path_for_pid(entry.th32ProcessID) {
                    if Path::new(&path).is_file() {
                        let _ = CloseHandle(snapshot);
                        return Some(path);
                    }
                }
            }

            if Process32NextW(snapshot, &mut entry).is_err() {
                break;
            }
        }

        let _ = CloseHandle(snapshot);
    }

    None
}

unsafe fn image_path_for_pid(pid: u32) -> Option<String> {
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buf = vec![0u16; 2048];
    let mut size = buf.len() as u32;
    let ok = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        windows::core::PWSTR(buf.as_mut_ptr()),
        &mut size,
    )
    .ok();
    let _ = CloseHandle(handle);
    ok?;
    Some(String::from_utf16_lossy(&buf[..size as usize]))
}

pub fn resolve_exe_path(os_browser_id: &str) -> Option<String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    if let Some(exe) = resolve_from_start_menu_internet(&hklm, os_browser_id) {
        return Some(exe);
    }
    if let Some(exe) = resolve_from_start_menu_internet(&hkcu, os_browser_id) {
        return Some(exe);
    }

    if os_browser_id == "brave" {
        if let Some(exe) = resolve_brave_install_path() {
            return Some(exe);
        }
    }

    resolve_from_running_process(os_browser_id)
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
