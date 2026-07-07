//! Persisted downloader settings — `app_data_dir()/download_settings.json`.

use tauri::Manager;

const FILE_NAME: &str = "download_settings.json";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DownloadSettings {
    pub output_dir: String,
    pub preferred_preset: String,
    pub concurrent_limit: u8,
    pub auto_open_on_complete: bool,
}

impl Default for DownloadSettings {
    fn default() -> Self {
        Self {
            output_dir: default_downloads_dir(),
            preferred_preset: "best".into(),
            concurrent_limit: 2,
            auto_open_on_complete: false,
        }
    }
}

fn default_downloads_dir() -> String {
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            return format!("{profile}\\Downloads");
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        return format!("{}/Downloads", home.to_string_lossy());
    }
    ".".into()
}

fn path(handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    handle
        .path()
        .app_data_dir()
        .map(|d| d.join(FILE_NAME))
        .map_err(|e| format!("app_data_dir: {e}"))
}

/// Corrupt/missing file ⇒ defaults (never an error path for callers).
pub fn load(handle: &tauri::AppHandle) -> DownloadSettings {
    let Ok(p) = path(handle) else {
        return DownloadSettings::default();
    };
    std::fs::read_to_string(p)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(handle: &tauri::AppHandle, settings: &DownloadSettings) -> Result<(), String> {
    let p = path(handle)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&p, json).map_err(|e| format!("write {}: {e}", p.display()))
}

/// Validate a user-chosen output directory: must exist, be a directory, and
/// be writable (probe file). Called by `dl_set_settings` and `dl_start`.
pub fn validate_output_dir(dir: &str) -> Result<(), String> {
    let p = std::path::Path::new(dir);
    if !p.is_absolute() {
        return Err("output_dir_not_absolute".into());
    }
    let meta = std::fs::metadata(p).map_err(|_| "output_dir_missing".to_string())?;
    if !meta.is_dir() {
        return Err("output_dir_not_a_directory".into());
    }
    let probe = p.join(format!(".pilpod_write_probe_{}", std::process::id()));
    std::fs::write(&probe, b"x").map_err(|_| "output_dir_not_writable".to_string())?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// Free bytes available to the current user on the volume holding `dir`.
/// `None` when the query fails (caller should NOT block the download then).
#[cfg(windows)]
pub fn free_disk_space(dir: &str) -> Option<u64> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let mut available: u64 = 0;
    unsafe {
        GetDiskFreeSpaceExW(
            &HSTRING::from(dir),
            Some(&mut available as *mut u64),
            None,
            None,
        )
        .ok()?;
    }
    Some(available)
}

#[cfg(not(windows))]
pub fn free_disk_space(_dir: &str) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        let s = DownloadSettings::default();
        assert_eq!(s.concurrent_limit, 2);
        assert_eq!(s.preferred_preset, "best");
        assert!(!s.output_dir.is_empty());
    }

    #[test]
    fn partial_json_fills_defaults() {
        let s: DownloadSettings = serde_json::from_str(r#"{"concurrentLimit":4}"#).unwrap();
        assert_eq!(s.concurrent_limit, 4);
        assert_eq!(s.preferred_preset, "best");
    }

    #[test]
    fn validate_rejects_relative_and_missing() {
        assert_eq!(
            validate_output_dir("relative/dir").unwrap_err(),
            "output_dir_not_absolute"
        );
        #[cfg(windows)]
        let missing = "C:\\pilpod_definitely_missing_dir_x9";
        #[cfg(not(windows))]
        let missing = "/pilpod_definitely_missing_dir_x9";
        assert_eq!(validate_output_dir(missing).unwrap_err(), "output_dir_missing");
    }

    #[test]
    fn validate_accepts_temp_dir() {
        let tmp = std::env::temp_dir();
        assert!(validate_output_dir(tmp.to_str().unwrap()).is_ok());
    }

    #[test]
    #[cfg(windows)]
    fn free_disk_space_reports_positive() {
        let tmp = std::env::temp_dir();
        assert!(free_disk_space(tmp.to_str().unwrap()).unwrap() > 0);
    }
}
