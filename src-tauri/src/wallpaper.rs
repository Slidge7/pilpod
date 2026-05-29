use std::path::Path;

use base64::Engine;
use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperData {
    pub path: String,
    pub data_url: String,
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    }
}

fn read_image_as_data_url(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let mime = mime_for(path);
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

/// Open a native file picker and return the chosen image as a data URL.
/// Returns `None` if the user cancels the dialog.
#[tauri::command]
pub async fn pick_wallpaper(app: tauri::AppHandle) -> Result<Option<WallpaperData>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .blocking_pick_file();

    let Some(file) = picked else {
        return Ok(None);
    };

    let path = file.into_path().map_err(|e| e.to_string())?;
    let data_url = read_image_as_data_url(&path)?;

    Ok(Some(WallpaperData {
        path: path.to_string_lossy().to_string(),
        data_url,
    }))
}

/// Re-read a previously selected wallpaper from disk and return it as a data URL.
#[tauri::command]
pub fn read_wallpaper(path: String) -> Result<Option<String>, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Ok(None);
    }
    Ok(Some(read_image_as_data_url(p)?))
}
