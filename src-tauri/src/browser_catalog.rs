//! Curated Windows browser catalog — single source of truth for OS detection,
//! wake/sync exe resolution, GSMTC dedup, window focus, and extension name mapping.
//!
//! # Included browsers (13)
//!
//! - **msedge** — Preinstalled on Windows; dominant Chromium share.
//! - **chrome** — Most common desktop browser.
//! - **firefox** — Primary Gecko/MV3 target.
//! - **brave** — Major privacy Chromium fork (HKLM key often `"Brave"`).
//! - **operagx** — Separate product from Opera; same `opera.exe`, disambiguated by path/registry.
//! - **opera** — Classic Opera; HKCU key often `"OperaStable"` (verified on dev machines).
//! - **vivaldi** — Power-user Chromium fork.
//! - **chromium** — OSS Chromium builds.
//! - **arc** — Chromium; often MSIX with weak StartMenuInternet registration.
//! - **librewolf** — Firefox fork; registry varies (`LibreWolf`, scoop variants).
//! - **waterfox** — Firefox fork; keys like `WATERFOX.EXE` or `Waterfox-{AppModelId}`.
//! - **yandex** — CIS market; `browser.exe` under `YandexBrowser` path.
//! - **tor** — Privacy browser; uses `firefox.exe`, disambiguated by `Tor Browser` path.
//!
//! # Excluded
//!
//! Safari and Samsung Internet (no meaningful Windows client), Internet Explorer (deprecated),
//! portable-only forks without registry, and niche forks (Zen, Floorp, etc.).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::RegKey;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

// ── Types ────────────────────────────────────────────────────────────────────

pub struct InstallPathReg {
    pub subkey: &'static str,
    pub value: &'static str,
    pub exe_rel: &'static str,
}

pub struct BrowserCatalogEntry {
    pub id: &'static str,
    pub display_name: &'static str,
    pub process_exe: &'static str,
    pub registry_client_names: &'static [&'static str],
    pub registry_key_prefixes: &'static [&'static str],
    pub install_path_reg: Option<InstallPathReg>,
    pub aumid_markers: &'static [&'static str],
    pub focus_window_hint: &'static str,
    pub focus_caption_hints: &'static [&'static str],
    pub extension_name_aliases: &'static [&'static str],
    pub process_path_markers: Option<&'static [&'static str]>,
    pub process_path_excludes: Option<&'static [&'static str]>,
}

const BRAVE_INSTALL: InstallPathReg = InstallPathReg {
    subkey: "SOFTWARE\\BraveSoftware\\Brave-Browser",
    value: "InstallPath",
    exe_rel: "brave.exe",
};

/// Order: specific forks before generic; used for path disambiguation and stable UI ordering.
pub const CATALOG: &[BrowserCatalogEntry] = &[
    BrowserCatalogEntry {
        id: "msedge",
        display_name: "Microsoft Edge",
        process_exe: "msedge.exe",
        registry_client_names: &["Microsoft Edge"],
        registry_key_prefixes: &[],
        install_path_reg: None,
        aumid_markers: &["msedge", "microsoftedge"],
        focus_window_hint: "edge",
        focus_caption_hints: &["Microsoft Edge", " - Edge"],
        extension_name_aliases: &["edge", "microsoft edge", "msedge"],
        process_path_markers: None,
        process_path_excludes: None,
    },
    BrowserCatalogEntry {
        id: "chrome",
        display_name: "Google Chrome",
        process_exe: "chrome.exe",
        registry_client_names: &["Google Chrome"],
        registry_key_prefixes: &[],
        install_path_reg: None,
        aumid_markers: &["chrome"],
        focus_window_hint: "chrome",
        focus_caption_hints: &["Google Chrome"],
        extension_name_aliases: &["chrome", "google chrome"],
        process_path_markers: None,
        process_path_excludes: None,
    },
    BrowserCatalogEntry {
        id: "brave",
        display_name: "Brave",
        process_exe: "brave.exe",
        registry_client_names: &["Brave", "Brave Browser", "BraveHTML", "Brave-Browser"],
        registry_key_prefixes: &[],
        install_path_reg: Some(BRAVE_INSTALL),
        aumid_markers: &["brave"],
        focus_window_hint: "brave",
        focus_caption_hints: &["Brave"],
        extension_name_aliases: &["brave"],
        process_path_markers: None,
        process_path_excludes: None,
    },
    BrowserCatalogEntry {
        id: "operagx",
        display_name: "Opera GX",
        process_exe: "opera.exe",
        registry_client_names: &["Opera GX Stable", "Opera GX"],
        registry_key_prefixes: &["opera gx"],
        install_path_reg: None,
        aumid_markers: &["operagx", "opera gx"],
        focus_window_hint: "operagx",
        focus_caption_hints: &["Opera GX"],
        extension_name_aliases: &["opera gx", "operagx"],
        process_path_markers: Some(&["\\opera gx\\", "opera gx"]),
        process_path_excludes: None,
    },
    BrowserCatalogEntry {
        id: "opera",
        display_name: "Opera",
        process_exe: "opera.exe",
        registry_client_names: &["OperaStable", "Opera Stable", "Opera"],
        registry_key_prefixes: &["operastable"],
        install_path_reg: None,
        aumid_markers: &["opera"],
        focus_window_hint: "opera",
        focus_caption_hints: &["Opera"],
        extension_name_aliases: &["opera"],
        process_path_markers: None,
        process_path_excludes: Some(&["\\opera gx\\", "opera gx"]),
    },
    BrowserCatalogEntry {
        id: "vivaldi",
        display_name: "Vivaldi",
        process_exe: "vivaldi.exe",
        registry_client_names: &["Vivaldi", "VIVALDI.EXE"],
        registry_key_prefixes: &["vivaldi"],
        install_path_reg: None,
        aumid_markers: &["vivaldi"],
        focus_window_hint: "vivaldi",
        focus_caption_hints: &["Vivaldi"],
        extension_name_aliases: &["vivaldi"],
        process_path_markers: None,
        process_path_excludes: None,
    },
    BrowserCatalogEntry {
        id: "chromium",
        display_name: "Chromium",
        process_exe: "chromium.exe",
        registry_client_names: &["Chromium"],
        registry_key_prefixes: &[],
        install_path_reg: None,
        aumid_markers: &["chromium"],
        focus_window_hint: "chromium",
        focus_caption_hints: &["Chromium"],
        extension_name_aliases: &["chromium"],
        process_path_markers: None,
        process_path_excludes: None,
    },
    BrowserCatalogEntry {
        id: "arc",
        display_name: "Arc",
        process_exe: "arc.exe",
        registry_client_names: &["Arc"],
        registry_key_prefixes: &[],
        install_path_reg: None,
        aumid_markers: &["arc", "thebrowsercompany"],
        focus_window_hint: "arc",
        focus_caption_hints: &["Arc"],
        extension_name_aliases: &["arc"],
        process_path_markers: Some(&["thebrowsercompany.arc", "\\arc\\"]),
        process_path_excludes: None,
    },
    BrowserCatalogEntry {
        id: "yandex",
        display_name: "Yandex Browser",
        process_exe: "browser.exe",
        registry_client_names: &[],
        registry_key_prefixes: &["yandex."],
        install_path_reg: None,
        aumid_markers: &["yandex"],
        focus_window_hint: "yandex",
        focus_caption_hints: &["Yandex"],
        extension_name_aliases: &["yandex", "yandex browser"],
        process_path_markers: Some(&["yandexbrowser"]),
        process_path_excludes: None,
    },
    BrowserCatalogEntry {
        id: "tor",
        display_name: "Tor Browser",
        process_exe: "firefox.exe",
        registry_client_names: &["Tor Browser"],
        registry_key_prefixes: &["tor browser"],
        install_path_reg: None,
        aumid_markers: &["tor browser", "torbrowser"],
        focus_window_hint: "tor",
        focus_caption_hints: &["Tor Browser"],
        extension_name_aliases: &["tor", "tor browser"],
        process_path_markers: Some(&["\\tor browser\\", "tor browser"]),
        process_path_excludes: None,
    },
    BrowserCatalogEntry {
        id: "firefox",
        display_name: "Mozilla Firefox",
        process_exe: "firefox.exe",
        registry_client_names: &["Firefox", "FIREFOX.EXE", "Mozilla Firefox"],
        registry_key_prefixes: &["firefox-"],
        install_path_reg: None,
        aumid_markers: &["firefox"],
        focus_window_hint: "firefox",
        focus_caption_hints: &["Firefox", "Mozilla"],
        extension_name_aliases: &["firefox", "mozilla firefox"],
        process_path_markers: None,
        process_path_excludes: Some(&["\\tor browser\\", "tor browser"]),
    },
    BrowserCatalogEntry {
        id: "librewolf",
        display_name: "LibreWolf",
        process_exe: "librewolf.exe",
        registry_client_names: &["LibreWolf"],
        registry_key_prefixes: &["librewolf"],
        install_path_reg: None,
        aumid_markers: &["librewolf"],
        focus_window_hint: "librewolf",
        focus_caption_hints: &["LibreWolf"],
        extension_name_aliases: &["librewolf"],
        process_path_markers: None,
        process_path_excludes: None,
    },
    BrowserCatalogEntry {
        id: "waterfox",
        display_name: "Waterfox",
        process_exe: "waterfox.exe",
        registry_client_names: &["WATERFOX.EXE", "Waterfox"],
        registry_key_prefixes: &["waterfox"],
        install_path_reg: None,
        aumid_markers: &["waterfox"],
        focus_window_hint: "waterfox",
        focus_caption_hints: &["Waterfox"],
        extension_name_aliases: &["waterfox"],
        process_path_markers: None,
        process_path_excludes: None,
    },
];

// ── Lookup ───────────────────────────────────────────────────────────────────

pub fn entry_by_id(id: &str) -> Option<&'static BrowserCatalogEntry> {
    CATALOG.iter().find(|e| e.id == id)
}

/// Map a browser name reported by the extension (or UI) to a stable catalog id.
pub fn browser_name_to_id(name: &str) -> String {
    let n = name.trim().to_lowercase();
    if n.is_empty() {
        return n;
    }

    for entry in CATALOG {
        if n == entry.id {
            return entry.id.to_string();
        }
        if n == entry.display_name.to_lowercase() {
            return entry.id.to_string();
        }
        for alias in entry.extension_name_aliases {
            if n == *alias {
                return entry.id.to_string();
            }
        }
    }

    n
}

/// Match a `StartMenuInternet` subkey name to a catalog entry (exact, then prefix).
pub fn match_registry_key(key_name: &str) -> Option<&'static BrowserCatalogEntry> {
    let lower = key_name.to_lowercase();

    for entry in CATALOG {
        for name in entry.registry_client_names {
            if lower == name.to_lowercase() {
                return Some(entry);
            }
        }
    }

    for entry in CATALOG {
        for prefix in entry.registry_key_prefixes {
            if lower.starts_with(prefix) {
                if entry.id == "chrome" && lower.contains("edge") {
                    continue;
                }
                if entry.id == "msedge" && lower.contains("chrome") && !lower.contains("edge") {
                    continue;
                }
                return Some(entry);
            }
        }
    }

    None
}

fn path_matches_entry(path: &str, entry: &BrowserCatalogEntry) -> bool {
    let lower = path.to_lowercase();

    if let Some(excludes) = entry.process_path_excludes {
        for ex in excludes {
            if lower.contains(ex) {
                return false;
            }
        }
    }

    if let Some(markers) = entry.process_path_markers {
        return markers.iter().any(|m| lower.contains(m));
    }

    true
}

/// Match a running process (exe name + optional full image path) to a catalog id.
pub fn match_running_process(exe: &str, full_path: Option<&str>) -> Option<&'static str> {
    let exe_lower = exe.to_lowercase();
    let path_lower = full_path.map(|p| p.to_lowercase());

    let candidates: Vec<&BrowserCatalogEntry> = CATALOG
        .iter()
        .filter(|e| e.process_exe.eq_ignore_ascii_case(&exe_lower))
        .collect();

    if candidates.is_empty() {
        return None;
    }

    if candidates.len() == 1 {
        let entry = candidates[0];
        if let Some(ref path) = path_lower {
            if entry.process_path_markers.is_some() || entry.process_path_excludes.is_some() {
                if path_matches_entry(path, entry) {
                    return Some(entry.id);
                }
                return None;
            }
        }
        return Some(entry.id);
    }

    if let Some(ref path) = path_lower {
        for entry in &candidates {
            if path_matches_entry(path, entry) {
                return Some(entry.id);
            }
        }
    }

    candidates.first().map(|e| e.id)
}

pub fn focus_entry_for_hint(hint: &str) -> Option<&'static BrowserCatalogEntry> {
    let h = hint.trim().to_lowercase();
    if h.is_empty() || h == "unknown" {
        return None;
    }
    for entry in CATALOG {
        if h == entry.focus_window_hint || h == entry.id {
            return Some(entry);
        }
        for alias in entry.extension_name_aliases {
            if h == *alias {
                return Some(entry);
            }
        }
    }
    None
}

pub fn caption_matches_entry(caption: &str, entry: &BrowserCatalogEntry) -> bool {
    entry
        .focus_caption_hints
        .iter()
        .any(|hint| caption.contains(hint))
}

// ── Exe resolution (wake & sync) ─────────────────────────────────────────────

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

fn resolve_from_start_menu_internet(hive: &RegKey, entry: &BrowserCatalogEntry) -> Option<String> {
    let base = hive
        .open_subkey("SOFTWARE\\Clients\\StartMenuInternet")
        .ok()?;

    for name in entry.registry_client_names {
        if let Some(exe) = read_exe_from_key(&base, name) {
            return Some(exe);
        }
    }

    for name in base.enum_keys().flatten() {
        if match_registry_key(&name).map(|e| e.id) == Some(entry.id) {
            if let Some(exe) = read_exe_from_key(&base, &name) {
                return Some(exe);
            }
        }
    }

    None
}

fn resolve_install_path(entry: &BrowserCatalogEntry) -> Option<String> {
    let spec = entry.install_path_reg.as_ref()?;
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let key = RegKey::predef(hive).open_subkey(spec.subkey).ok()?;
        if let Ok(install) = key.get_value::<String, _>(spec.value) {
            let exe = Path::new(&install).join(spec.exe_rel);
            if exe.is_file() {
                return Some(exe.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// MSIX package folder prefix under `%LOCALAPPDATA%\\Packages` (e.g. Arc).
fn msix_package_prefix(entry: &BrowserCatalogEntry) -> Option<&'static str> {
    match entry.id {
        "arc" => Some("TheBrowserCompany.Arc"),
        _ => None,
    }
}

fn is_msix_package_installed(entry: &BrowserCatalogEntry) -> bool {
    let Some(prefix) = msix_package_prefix(entry) else {
        return false;
    };
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return false;
    };
    let packages = PathBuf::from(local).join("Packages");
    let Ok(read_dir) = std::fs::read_dir(packages) else {
        return false;
    };
    read_dir.filter_map(Result::ok).any(|entry| {
        entry
            .file_name()
            .to_string_lossy()
            .starts_with(prefix)
    })
}

fn resolve_from_app_paths(entry: &BrowserCatalogEntry) -> Option<String> {
    let subkey = format!(
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{}",
        entry.process_exe
    );
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let root = RegKey::predef(hive);
        let Ok(key) = root.open_subkey(&subkey) else {
            continue;
        };
        if let Ok(path) = key.get_value::<String, _>("") {
            if let Some(exe) = normalize_exe_path(&path) {
                return Some(exe);
            }
        }
    }
    None
}

fn parse_exe_path(raw: &str) -> Option<String> {
    let path = raw.trim().trim_matches('"').split(',').next()?.trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

fn normalize_exe_path(raw: &str) -> Option<String> {
    let path = parse_exe_path(raw)?;
    if Path::new(&path).is_file() {
        Some(path)
    } else {
        None
    }
}

fn uninstall_key_matches(entry: &BrowserCatalogEntry, key_name: &str) -> bool {
    let key_lower = key_name.to_lowercase();

    for name in entry.registry_client_names {
        if key_lower.contains(&name.to_lowercase()) {
            return true;
        }
    }
    for prefix in entry.registry_key_prefixes {
        if key_lower.starts_with(prefix) {
            return true;
        }
    }
    for marker in entry.aumid_markers {
        if key_lower.contains(marker) {
            return true;
        }
    }

    false
}

fn resolve_from_uninstall(entry: &BrowserCatalogEntry) -> Option<String> {
    const UNINSTALL_PATHS: &[&str] = &[
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let root = RegKey::predef(hive);
        for path in UNINSTALL_PATHS {
            let Ok(uninstall) = root.open_subkey(path) else {
                continue;
            };
            for key_name in uninstall.enum_keys().flatten() {
                if !uninstall_key_matches(entry, &key_name) {
                    continue;
                }
                let Ok(sub) = uninstall.open_subkey(&key_name) else {
                    continue;
                };

                if let Ok(icon) = sub.get_value::<String, _>("DisplayIcon") {
                    if let Some(exe) = normalize_exe_path(&icon) {
                        return Some(exe);
                    }
                }

                if let Ok(loc) = sub.get_value::<String, _>("InstallLocation") {
                    let exe = Path::new(loc.trim()).join(entry.process_exe);
                    if exe.is_file() {
                        return Some(exe.to_string_lossy().into_owned());
                    }
                }
            }
        }
    }

    None
}

fn resolve_install_locations(entry: &BrowserCatalogEntry) -> Option<String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    resolve_from_start_menu_internet(&hklm, entry)
        .or_else(|| resolve_from_start_menu_internet(&hkcu, entry))
        .or_else(|| resolve_install_path(entry))
        .or_else(|| resolve_from_app_paths(entry))
        .or_else(|| resolve_from_uninstall(entry))
}

/// Browsers missing from `StartMenuInternet` (MSIX, App Paths, uninstall keys).
pub fn scan_supplemental_installed() -> HashSet<String> {
    let mut found = HashSet::new();
    for entry in CATALOG {
        if is_msix_package_installed(entry)
            || resolve_from_app_paths(entry).is_some()
            || resolve_from_uninstall(entry).is_some()
        {
            found.insert(entry.id.to_string());
        }
    }
    found
}

pub unsafe fn image_path_for_pid(pid: u32) -> Option<String> {
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

fn resolve_from_running_process(entry: &BrowserCatalogEntry) -> Option<String> {
    let target = entry.process_exe.to_lowercase();

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut pe = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut pe).is_err() {
            let _ = CloseHandle(snapshot);
            return None;
        }

        loop {
            let len = pe
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(pe.szExeFile.len());
            let name = String::from_utf16_lossy(&pe.szExeFile[..len]).to_lowercase();

            if name == target {
                let full_path = image_path_for_pid(pe.th32ProcessID);
                let path_ref = full_path.as_deref();
                if match_running_process(&name, path_ref) == Some(entry.id) {
                    if let Some(ref path) = full_path {
                        if Path::new(path).is_file() {
                            let _ = CloseHandle(snapshot);
                            return Some(path.clone());
                        }
                    }
                }
            }

            if Process32NextW(snapshot, &mut pe).is_err() {
                break;
            }
        }

        let _ = CloseHandle(snapshot);
    }

    None
}

pub fn resolve_exe_path(os_browser_id: &str) -> Option<String> {
    let entry = entry_by_id(os_browser_id)?;

    if let Some(exe) = resolve_install_locations(entry) {
        return Some(exe);
    }

    resolve_from_running_process(entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_name_to_id_edge_maps_msedge() {
        assert_eq!(browser_name_to_id("Edge"), "msedge");
        assert_eq!(browser_name_to_id("Microsoft Edge"), "msedge");
    }

    #[test]
    fn browser_name_to_id_chrome_and_operagx() {
        assert_eq!(browser_name_to_id("Google Chrome"), "chrome");
        assert_eq!(browser_name_to_id("Chrome"), "chrome");
        assert_eq!(browser_name_to_id("Opera GX"), "operagx");
    }

    #[test]
    fn browser_name_to_id_unknown_passthrough() {
        assert_eq!(browser_name_to_id("SomeNewBrowser"), "somenewbrowser");
    }

    #[test]
    fn match_registry_key_brave_and_opera_stable() {
        assert_eq!(match_registry_key("Brave").map(|e| e.id), Some("brave"));
        assert_eq!(
            match_registry_key("OperaStable").map(|e| e.id),
            Some("opera")
        );
    }

    #[test]
    fn match_registry_key_firefox_suffix() {
        assert_eq!(
            match_registry_key("Firefox-308046B0AF4A39CB").map(|e| e.id),
            Some("firefox")
        );
    }

    #[test]
    fn match_registry_key_chrome_and_edge() {
        assert_eq!(
            match_registry_key("Google Chrome").map(|e| e.id),
            Some("chrome")
        );
        assert_eq!(
            match_registry_key("Microsoft Edge").map(|e| e.id),
            Some("msedge")
        );
        assert!(match_registry_key("IEXPLORE.EXE").is_none());
    }

    #[test]
    fn match_running_process_opera_gx_vs_opera() {
        assert_eq!(
            match_running_process(
                "opera.exe",
                Some(r"C:\Program Files\Opera GX\opera.exe")
            ),
            Some("operagx")
        );
        assert_eq!(
            match_running_process(
                "opera.exe",
                Some(r"C:\Users\me\AppData\Local\Programs\Opera\opera.exe")
            ),
            Some("opera")
        );
    }

    #[test]
    fn match_running_process_tor_vs_firefox() {
        assert_eq!(
            match_running_process(
                "firefox.exe",
                Some(r"C:\Users\me\Desktop\Tor Browser\Browser\firefox.exe")
            ),
            Some("tor")
        );
        assert_eq!(
            match_running_process(
                "firefox.exe",
                Some(r"C:\Program Files\Mozilla Firefox\firefox.exe")
            ),
            Some("firefox")
        );
    }

    #[test]
    fn catalog_ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for e in CATALOG {
            assert!(seen.insert(e.id), "duplicate id: {}", e.id);
        }
    }

    #[test]
    fn parse_exe_path_strips_icon_index() {
        assert_eq!(
            parse_exe_path(r#"C:\Apps\arc.exe,0"#),
            Some(r"C:\Apps\arc.exe".to_string())
        );
    }

    #[test]
    fn uninstall_key_matches_arc_msix_key() {
        let arc = entry_by_id("arc").unwrap();
        assert!(uninstall_key_matches(
            arc,
            "TheBrowserCompany.Arc_ttt1ap7aakyb4"
        ));
    }
}
