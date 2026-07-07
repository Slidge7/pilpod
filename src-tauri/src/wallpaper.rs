use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use base64::Engine;
use tauri::path::BaseDirectory;
use tauri::Manager;

/// Appearance folders that live under `wallpapers/`.
const MODES: [&str; 2] = ["light", "dark"];

/// Image extensions we treat as wallpapers. Kept generous so new files just work.
const IMAGE_EXTS: [&str; 6] = ["jpg", "jpeg", "png", "webp", "bmp", "gif"];

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

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .map(|ext| IMAGE_EXTS.contains(&ext.as_str()))
        .unwrap_or(false)
}

fn read_image_as_data_url(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let mime = mime_for(path);
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

/// Locate the bundled `wallpapers/` directory.
///
/// In a packaged build this lives in the resource dir. In `tauri dev` the
/// resource dir may not contain it, so we fall back to the source tree via
/// `CARGO_MANIFEST_DIR`. Nothing here is hardcoded to specific image names.
fn wallpapers_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(p) = app.path().resolve("wallpapers", BaseDirectory::Resource) {
        if p.is_dir() {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("wallpapers");
    if dev.is_dir() {
        return Some(dev);
    }
    None
}

/// Read the image file names present in one mode folder.
fn names_in_mode(root: &Path, mode: &str) -> BTreeSet<String> {
    let dir = root.join(mode);
    let mut out = BTreeSet::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && is_image(&path) {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                out.insert(name.to_string());
            }
        }
    }
    out
}

/// List available wallpapers: file names that exist in **both** the light and
/// dark folders, sorted alphabetically. The name is the pairing key used by
/// `read_wallpaper`.
#[tauri::command]
pub fn list_wallpapers(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let Some(root) = wallpapers_root(&app) else {
        return Ok(Vec::new());
    };
    let light = names_in_mode(&root, "light");
    let dark = names_in_mode(&root, "dark");
    // Only pairs that exist in both modes are usable.
    Ok(light.intersection(&dark).cloned().collect())
}

/// Read a single bundled wallpaper as a data URL.
///
/// `mode` is "light" or "dark"; `name` is the paired file name returned by
/// `list_wallpapers`. Returns `None` if the file is missing.
#[tauri::command]
pub fn read_wallpaper(
    app: tauri::AppHandle,
    mode: String,
    name: String,
) -> Result<Option<String>, String> {
    if !MODES.contains(&mode.as_str()) {
        return Err(format!("invalid mode: {mode}"));
    }
    // Guard against path traversal — `name` must be a bare file name.
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid wallpaper name".to_string());
    }

    let Some(root) = wallpapers_root(&app) else {
        return Ok(None);
    };
    let path = root.join(&mode).join(&name);
    if !path.is_file() {
        return Ok(None);
    }
    Ok(Some(read_image_as_data_url(&path)?))
}
