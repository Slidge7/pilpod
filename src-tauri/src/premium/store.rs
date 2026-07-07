//! Persistence of the activated license token.
//! Stored at `app_data_dir()/license.json` as `{ "token": "PP1...." }`.

use tauri::Manager;

const FILE_NAME: &str = "license.json";

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredLicense {
    token: String,
}

fn path(handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(dir.join(FILE_NAME))
}

/// Returns the stored token, or `None` if absent/unreadable/corrupt.
/// Corruption is not an error — the caller simply falls back to Free tier.
pub fn load(handle: &tauri::AppHandle) -> Option<String> {
    let p = path(handle).ok()?;
    let raw = std::fs::read_to_string(p).ok()?;
    let stored: StoredLicense = serde_json::from_str(&raw).ok()?;
    if stored.token.trim().is_empty() {
        None
    } else {
        Some(stored.token)
    }
}

pub fn save(handle: &tauri::AppHandle, token: &str) -> Result<(), String> {
    let p = path(handle)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
    }
    let json = serde_json::to_string_pretty(&StoredLicense {
        token: token.to_string(),
    })
    .map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&p, json).map_err(|e| format!("write {}: {e}", p.display()))
}

pub fn delete(handle: &tauri::AppHandle) -> Result<(), String> {
    let p = path(handle)?;
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove {}: {e}", p.display())),
    }
}
