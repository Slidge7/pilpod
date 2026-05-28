//! OS-level browser inventory for Dev Lab: full catalog, process/window state,
//! and on-disk PilPod Companion detection (not extension bridge heartbeats).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, TRUE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongW,
    GetWindowThreadProcessId, IsHungAppWindow, IsWindowVisible, GA_ROOT, GWL_STYLE, GW_OWNER,
    WS_CHILD,
};

use crate::browser_catalog::{image_path_for_pid, match_running_process, CATALOG};
use crate::browser_detector::scan_installed_browsers;

const PILPOD_EXTENSION_NAME: &str = "PilPod Companion";

enum BrowserProfileRoot {
    LocalAppData(&'static str),
    AppData(&'static str),
}

/// Dev Lab process/window state (OS-only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DevBrowserProcessState {
    /// Not registered as installed on this PC.
    NotInstalled,
    /// Installed but no matching process.
    NotRunning,
    /// Process running without a StartMenuInternet entry (portable / side-loaded).
    Portable,
    /// Running; at least one main window has the foreground.
    Active,
    /// Running; visible windows but another app is in the foreground.
    Inactive,
    /// Running; `IsHungAppWindow` reported on a main browser frame.
    NotResponding,
    /// Running (no hung window); no qualifying visible frame (background-only).
    Running,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevOsBrowserScanRow {
    pub id: String,
    pub display_name: String,
    pub installed: bool,
    /// Legacy boolean: any matching process is running.
    pub running: bool,
    pub process_state: DevBrowserProcessState,
    pub process_count: u32,
    /// PilPod Companion found under this browser's profile directories.
    pub extension_installed_os: bool,
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone)]
struct RunningProcess {
    pid: u32,
}

#[derive(Default)]
struct WindowFlags {
    visible: bool,
    hung: bool,
    foreground: bool,
    window_count: u32,
}

fn scan_running_with_pids() -> HashMap<&'static str, Vec<RunningProcess>> {
    let mut map: HashMap<&'static str, Vec<RunningProcess>> = HashMap::new();

    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return map;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                let full_path = image_path_for_pid(entry.th32ProcessID);
                if let Some(id) =
                    match_running_process(&name, full_path.as_deref())
                {
                    map.entry(id)
                        .or_default()
                        .push(RunningProcess {
                            pid: entry.th32ProcessID,
                        });
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }

    map
}

fn foreground_pid() -> u32 {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return 0;
        }
        let mut pid = 0u32;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        pid
    }
}

fn browser_frame_class_ok(class: &str) -> bool {
    matches!(class.trim(), "Chrome_WidgetWin_1" | "MozillaWindowClass")
}

struct WindowScanCtx {
    pid_to_browser: HashMap<u32, &'static str>,
    fg_pid: u32,
    flags: HashMap<&'static str, WindowFlags>,
}

unsafe extern "system" fn enum_windows_for_browsers(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut WindowScanCtx);

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

    let owner = GetWindow(hwnd, GW_OWNER);
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

    let mut pid = 0u32;
    let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let Some(id) = ctx.pid_to_browser.get(&pid).copied() else {
        return TRUE;
    };

    let entry = ctx.flags.entry(id).or_default();
    entry.visible = true;
    entry.window_count = entry.window_count.saturating_add(1);
    if IsHungAppWindow(hwnd).as_bool() {
        entry.hung = true;
    }
    if pid == ctx.fg_pid {
        entry.foreground = true;
    }

    TRUE
}

fn build_pid_to_browser(running: &HashMap<&'static str, Vec<RunningProcess>>) -> HashMap<u32, &'static str> {
    let mut map = HashMap::new();
    for (id, procs) in running {
        for p in procs {
            map.insert(p.pid, *id);
        }
    }
    map
}

fn scan_window_flags(
    running: &HashMap<&'static str, Vec<RunningProcess>>,
) -> HashMap<&'static str, WindowFlags> {
    let pid_to_browser = build_pid_to_browser(running);
    if pid_to_browser.is_empty() {
        return HashMap::new();
    }

    let mut ctx = WindowScanCtx {
        pid_to_browser,
        fg_pid: foreground_pid(),
        flags: HashMap::new(),
    };

    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_for_browsers),
            LPARAM(&mut ctx as *mut WindowScanCtx as isize),
        );
    }

    ctx.flags
}

fn resolve_process_state(
    id: &str,
    installed: bool,
    running: &HashMap<&'static str, Vec<RunningProcess>>,
    windows: &HashMap<&'static str, WindowFlags>,
) -> DevBrowserProcessState {
    let procs = running.get(id);
    if procs.is_none() || procs.is_some_and(|v| v.is_empty()) {
        return if installed {
            DevBrowserProcessState::NotRunning
        } else {
            DevBrowserProcessState::NotInstalled
        };
    }

    if !installed {
        return DevBrowserProcessState::Portable;
    }

    if let Some(flags) = windows.get(id) {
        if flags.hung {
            return DevBrowserProcessState::NotResponding;
        }
        if flags.foreground {
            return DevBrowserProcessState::Active;
        }
        if flags.visible {
            return DevBrowserProcessState::Inactive;
        }
    }

    DevBrowserProcessState::Running
}

fn text_mentions_pilpod(text: &str) -> bool {
    text.contains(PILPOD_EXTENSION_NAME)
}

fn manifest_is_pilpod(path: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    if text_mentions_pilpod(&text) {
        return true;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    value
        .get("name")
        .and_then(|v| v.as_str())
        .map(|n| n == PILPOD_EXTENSION_NAME)
        .unwrap_or(false)
}

fn preferences_mention_pilpod(path: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    text_mentions_pilpod(&text)
}

fn is_chromium_profile_dir(name: &str) -> bool {
    let n = name.to_lowercase();
    n == "default"
        || n.starts_with("profile ")
        || n.starts_with("profile_")
        || n == "guest profile"
}

fn scan_chromium_profile_dir(profile: &Path) -> bool {
    let ext_root = profile.join("Extensions");
    if scan_chromium_extensions_dir(&ext_root) {
        return true;
    }
    for prefs_name in ["Preferences", "Secure Preferences"] {
        let prefs = profile.join(prefs_name);
        if prefs.is_file() && preferences_mention_pilpod(&prefs) {
            return true;
        }
    }
    false
}

fn scan_chromium_profiles_at(root: &Path) -> bool {
    if !root.is_dir() {
        return false;
    }

    // Opera-style: profiles live directly under the browser folder (e.g. …/Default).
    if root.join("Preferences").is_file() || root.join("Extensions").is_dir() {
        if scan_chromium_profile_dir(root) {
            return true;
        }
    }

    let Ok(profiles) = std::fs::read_dir(root) else {
        return false;
    };

    for profile in profiles.flatten() {
        let name = profile.file_name().to_string_lossy().into_owned();
        let lower = name.to_lowercase();
        if lower == "system profile" || lower.starts_with("snapshots") {
            continue;
        }
        if is_chromium_profile_dir(&name) || profile.path().join("Preferences").is_file() {
            if scan_chromium_profile_dir(&profile.path()) {
                return true;
            }
        }
    }
    false
}

fn profile_root_base(root: BrowserProfileRoot) -> Option<PathBuf> {
    match root {
        BrowserProfileRoot::LocalAppData(rel) => {
            std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join(rel))
        }
        BrowserProfileRoot::AppData(rel) => {
            std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join(rel))
        }
    }
}

fn scan_chromium_extensions(root: BrowserProfileRoot) -> bool {
    profile_root_base(root)
        .map(|p| scan_chromium_profiles_at(&p))
        .unwrap_or(false)
}

fn scan_chromium_extensions_dir(ext_root: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(ext_root) else {
        return false;
    };
    for ext_id in entries.flatten() {
        let Ok(versions) = std::fs::read_dir(ext_id.path()) else {
            continue;
        };
        for ver in versions.flatten() {
            let manifest = ver.path().join("manifest.json");
            if manifest.is_file() && manifest_is_pilpod(&manifest) {
                return true;
            }
        }
    }
    false
}

fn scan_firefox_extensions(appdata_rel: &str) -> bool {
    let Some(roaming) = std::env::var_os("APPDATA") else {
        return false;
    };
    let profiles_root = PathBuf::from(roaming).join(appdata_rel).join("Profiles");
    if !profiles_root.is_dir() {
        return false;
    }

    let Ok(profiles) = std::fs::read_dir(&profiles_root) else {
        return false;
    };

    for profile in profiles.flatten() {
        let path = profile.path();
        let extensions_json = path.join("extensions.json");
        if extensions_json.is_file() && firefox_extensions_json_has_pilpod(&extensions_json) {
            return true;
        }
        let ext_dir = path.join("extensions");
        if ext_dir.is_dir() && scan_firefox_extensions_dir(&ext_dir) {
            return true;
        }
    }
    false
}

fn firefox_extensions_json_has_pilpod(path: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    text.contains(PILPOD_EXTENSION_NAME)
}

fn scan_firefox_extensions_dir(ext_dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(ext_dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("xpi") {
            // Cheap check: XPI is a zip; read manifest name from filename only is unreliable.
            // Fall through to extensions.json path above for most installs.
            continue;
        }
        let manifest = path.join("manifest.json");
        if manifest.is_file() && manifest_is_pilpod(&manifest) {
            return true;
        }
    }
    false
}

fn scan_arc_msix_extension() -> bool {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return false;
    };
    let packages = PathBuf::from(local).join("Packages");
    let Ok(entries) = std::fs::read_dir(&packages) else {
        return false;
    };
    for pkg in entries.flatten() {
        let name = pkg.file_name().to_string_lossy().into_owned();
        if !name.starts_with("TheBrowserCompany.Arc") {
            continue;
        }
        let ext_root = pkg
            .path()
            .join("LocalCache")
            .join("Local")
            .join("User Data")
            .join("Default")
            .join("Extensions");
        if scan_chromium_extensions_dir(&ext_root) {
            return true;
        }
    }
    false
}

fn browser_profile_root(browser_id: &str) -> Option<BrowserProfileRoot> {
    match browser_id {
        "msedge" => Some(BrowserProfileRoot::LocalAppData(
            r"Microsoft\Edge\User Data",
        )),
        "chrome" => Some(BrowserProfileRoot::LocalAppData(
            r"Google\Chrome\User Data",
        )),
        "brave" => Some(BrowserProfileRoot::LocalAppData(
            r"BraveSoftware\Brave-Browser\User Data",
        )),
        "vivaldi" => Some(BrowserProfileRoot::LocalAppData(r"Vivaldi\User Data")),
        "chromium" => Some(BrowserProfileRoot::LocalAppData(r"Chromium\User Data")),
        "opera" => Some(BrowserProfileRoot::AppData(r"Opera Software\Opera Stable")),
        "operagx" => Some(BrowserProfileRoot::AppData(r"Opera Software\Opera GX Stable")),
        "yandex" => Some(BrowserProfileRoot::LocalAppData(
            r"Yandex\YandexBrowser\User Data",
        )),
        _ => None,
    }
}

/// Firefox-family folder relative to `%APPDATA%`.
fn firefox_appdata_rel(browser_id: &str) -> Option<&'static str> {
    match browser_id {
        "firefox" => Some("Mozilla/Firefox"),
        "librewolf" => Some("librewolf"),
        "waterfox" => Some("Waterfox"),
        _ => None,
    }
}

pub fn scan_os_extension_installed(browser_id: &str) -> bool {
    if browser_id == "arc" {
        return scan_arc_msix_extension();
    }
    if let Some(root) = browser_profile_root(browser_id) {
        if scan_chromium_extensions(root) {
            return true;
        }
    }
    if let Some(rel) = firefox_appdata_rel(browser_id) {
        if scan_firefox_extensions(rel) {
            return true;
        }
    }
    false
}

fn display_process_count(
    id: &str,
    running: &HashMap<&'static str, Vec<RunningProcess>>,
    windows: &HashMap<&'static str, WindowFlags>,
) -> u32 {
    if let Some(flags) = windows.get(id) {
        if flags.window_count > 0 {
            return flags.window_count;
        }
    }
    if running.get(id).is_some_and(|v| !v.is_empty()) {
        return 1;
    }
    0
}

/// Full catalog scan for Dev Lab (installed / not installed, process state, on-disk extension).
pub fn build_dev_os_browser_rows() -> Vec<DevOsBrowserScanRow> {
    let installed = scan_installed_browsers();
    let running = scan_running_with_pids();
    let windows = scan_window_flags(&running);

    CATALOG
        .iter()
        .map(|entry| {
            let id = entry.id;
            let is_installed = installed.contains(id);
            let process_count = display_process_count(id, &running, &windows);
            let running_bool = running.get(id).is_some_and(|v| !v.is_empty());
            let process_state =
                resolve_process_state(id, is_installed, &running, &windows);
            let extension_installed_os = scan_os_extension_installed(id);

            DevOsBrowserScanRow {
                id: id.to_string(),
                display_name: entry.display_name.to_string(),
                installed: is_installed,
                running: running_bool,
                process_state,
                process_count,
                extension_installed_os,
                icon_url: crate::browser_icon::data_url_for_browser(id),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_not_installed_when_absent() {
        let running = HashMap::new();
        let windows = HashMap::new();
        assert_eq!(
            resolve_process_state("chrome", false, &running, &windows),
            DevBrowserProcessState::NotInstalled
        );
    }

    #[test]
    fn resolve_not_running_when_installed_only() {
        let running = HashMap::new();
        let windows = HashMap::new();
        assert_eq!(
            resolve_process_state("chrome", true, &running, &windows),
            DevBrowserProcessState::NotRunning
        );
    }

    #[test]
    fn resolve_portable_when_running_not_installed() {
        let mut running = HashMap::new();
        running.insert("chrome", vec![RunningProcess { pid: 1 }]);
        let windows = HashMap::new();
        assert_eq!(
            resolve_process_state("chrome", false, &running, &windows),
            DevBrowserProcessState::Portable
        );
    }

    #[test]
    fn manifest_is_pilpod_matches_name() {
        let dir = std::env::temp_dir().join("pilpod_manifest_test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("manifest.json");
        std::fs::write(&path, r#"{"name":"PilPod Companion","version":"1"}"#).unwrap();
        assert!(manifest_is_pilpod(&path));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
