//! The only file that touches the widget's on-disk representation.
//!
//! One small JSON file at `app_data_dir()/widget_settings.json`, read once at
//! startup and rewritten atomically on a debounced save. Same discipline as
//! the vault store (tmp file + rename, corrupt files moved aside rather than
//! destroyed), scaled down to match the stakes: losing a corner preference is
//! not losing bookmarks, so a corrupt file simply resets to defaults instead
//! of surfacing an error to the user.

use std::path::{Path, PathBuf};

use tauri::Manager;

use super::model::{WidgetSettings, SETTINGS_VERSION};

const FILE_NAME: &str = "widget_settings.json";

pub fn store_path(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(dir.join(FILE_NAME))
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_else(|| FILE_NAME.into());
    name.push(".tmp");
    path.with_file_name(name)
}

/// Load settings from `path`. Never fails: a missing, unreadable, corrupt or
/// future-versioned file yields [`WidgetSettings::default`].
pub fn load_from(path: &Path) -> WidgetSettings {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return WidgetSettings::default();
    };
    match serde_json::from_str::<WidgetSettings>(&raw) {
        Ok(s) if s.version <= SETTINGS_VERSION => s,
        Ok(s) => {
            log::warn!(
                "[widget] settings version {} is newer than {SETTINGS_VERSION} — using defaults",
                s.version
            );
            WidgetSettings::default()
        }
        Err(e) => {
            log::warn!("[widget] settings unreadable ({e}) — using defaults");
            WidgetSettings::default()
        }
    }
}

/// Write settings to `path` atomically: serialize to `<file>.tmp`, then rename
/// over the original so an interrupted write can never leave a truncated file.
pub fn save_to(path: &Path, settings: &WidgetSettings) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("create_dir_all: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| format!("serialize: {e}"))?;
    let tmp = tmp_path(path);
    std::fs::write(&tmp, json).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::widget::model::{WidgetCorner, WidgetPlacement};

    fn tmp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pilpod-widget-store-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_loads_defaults() {
        let p = tmp_dir().join("does-not-exist.json");
        assert_eq!(load_from(&p), WidgetSettings::default());
    }

    #[test]
    fn round_trips_through_disk() {
        let p = tmp_dir().join("round-trip.json");
        let settings = WidgetSettings {
            version: SETTINGS_VERSION,
            enabled: true,
            placement: WidgetPlacement::Free { x: 100.0, y: 250.5 },
        };
        save_to(&p, &settings).unwrap();
        assert_eq!(load_from(&p), settings);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn corrupt_json_falls_back_instead_of_panicking() {
        let p = tmp_dir().join("corrupt.json");
        std::fs::write(&p, "{ not json at all").unwrap();
        assert_eq!(load_from(&p), WidgetSettings::default());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn future_version_falls_back() {
        let p = tmp_dir().join("future.json");
        std::fs::write(
            &p,
            r#"{"version":9999,"enabled":true,"placement":{"mode":"corner","corner":"topLeft"}}"#,
        )
        .unwrap();
        assert_eq!(load_from(&p), WidgetSettings::default());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn save_leaves_no_tmp_file_behind() {
        let p = tmp_dir().join("no-tmp.json");
        save_to(
            &p,
            &WidgetSettings {
                enabled: true,
                placement: WidgetPlacement::Corner {
                    corner: WidgetCorner::TopRight,
                },
                ..WidgetSettings::default()
            },
        )
        .unwrap();
        assert!(!tmp_path(&p).exists());
        let _ = std::fs::remove_file(&p);
    }
}
