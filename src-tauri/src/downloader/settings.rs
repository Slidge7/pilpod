use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DownloadSettings {
    pub output_dir: String,
    pub preferred_format: String,
    pub concurrent_limit: u8,
    pub auto_open_on_complete: bool,
}

impl DownloadSettings {
    fn default_download_dir(app: &AppHandle) -> String {
        // Prefer the system Downloads folder via Tauri's path resolver.
        if let Ok(p) = app.path().download_dir() {
            return p.to_string_lossy().into_owned();
        }
        // Fallback: user home.
        if let Ok(p) = app.path().home_dir() {
            return p.join("Downloads").to_string_lossy().into_owned();
        }
        ".".to_string()
    }

    pub fn default_for(app: &AppHandle) -> Self {
        Self {
            output_dir: Self::default_download_dir(app),
            preferred_format: "bestvideo+bestaudio/best".into(),
            concurrent_limit: 2,
            auto_open_on_complete: false,
        }
    }
}

fn settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("pilpod")
        .join("download_settings.json")
}

pub fn load(app: &AppHandle) -> DownloadSettings {
    let path = settings_path(app);
    if let Ok(data) = std::fs::read_to_string(&path) {
        if let Ok(s) = serde_json::from_str::<DownloadSettings>(&data) {
            return s;
        }
    }
    DownloadSettings::default_for(app)
}

pub fn save(app: &AppHandle, settings: &DownloadSettings) -> Result<(), String> {
    let path = settings_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(())
}
