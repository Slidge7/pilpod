//! The only file that touches the vault's on-disk representation.
//!
//! Single JSON file at `app_data_dir()/vault_store.json`, loaded whole at
//! startup and rewritten atomically on debounced saves. This is the documented
//! "store swap seam": if the dataset ever outgrows JSON, replacing the bodies
//! of [`load_from`] / [`save_to`] with a SQLite-backed implementation touches
//! nothing else in the vault.
//!
//! Write discipline:
//!   * **Atomic** — serialize to `vault_store.json.tmp`, then rename over the
//!     original. A crash mid-write can never truncate the real file (an
//!     improvement over the downloader's direct `fs::write`, because bookmarks
//!     are irreplaceable user data).
//!   * **Corruption policy** — a corrupt or future-versioned file is *renamed*
//!     to `vault_store.json.bak-<ms>` before the vault starts empty, so user
//!     data is preserved for manual recovery rather than silently destroyed.

use std::path::{Path, PathBuf};
use tauri::Manager;

use super::dto::{VaultData, STORE_VERSION};

const FILE_NAME: &str = "vault_store.json";

/// Resolve the store path under the app data dir.
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

/// Move a bad file aside to `vault_store.json.bak-<ms>` (best effort).
fn backup_corrupt(path: &Path) {
    let ts = super::now_ms();
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_else(|| FILE_NAME.into());
    name.push(format!(".bak-{ts}"));
    let dest = path.with_file_name(name);
    match std::fs::rename(path, &dest) {
        Ok(()) => log::warn!(
            "[vault] corrupt store backed up to {} — starting empty",
            dest.display()
        ),
        Err(e) => log::warn!("[vault] could not back up corrupt store: {e}"),
    }
}

/// Load the vault from `path`. Missing file ⇒ empty vault (not an error).
/// Corrupt JSON or a version newer than we understand ⇒ back the file up and
/// return an empty vault. Never panics, never returns `Err`.
pub fn load_from(path: &Path) -> VaultData {
    let raw = match std::fs::read_to_string(path) {
        Ok(r) => r,
        Err(_) => return VaultData::default(), // absent / unreadable
    };
    match serde_json::from_str::<VaultData>(&raw) {
        Ok(data) if data.version <= STORE_VERSION => data,
        Ok(_) => {
            // Higher version: written by a newer build — do not risk lossy edits.
            backup_corrupt(path);
            VaultData::default()
        }
        Err(_) => {
            backup_corrupt(path);
            VaultData::default()
        }
    }
}

/// Atomically persist `data` to `path` (tmp file + rename). Creates the parent
/// directory if needed. Returns a stringly error on any I/O failure so the
/// caller can log and retry.
pub fn save_to(path: &Path, data: &VaultData) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
    }
    let json = serde_json::to_string_pretty(data).map_err(|e| format!("serialize: {e}"))?;
    let tmp = tmp_path(path);
    std::fs::write(&tmp, json).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        // Leave no orphan tmp behind on failure.
        let _ = std::fs::remove_file(&tmp);
        format!("rename {} -> {}: {e}", tmp.display(), path.display())
    })
}

/// AppHandle convenience wrapper over [`load_from`].
pub fn load(handle: &tauri::AppHandle) -> VaultData {
    match store_path(handle) {
        Ok(p) => load_from(&p),
        Err(e) => {
            log::warn!("[vault] load: {e} — starting empty");
            VaultData::default()
        }
    }
}

/// AppHandle convenience wrapper over [`save_to`].
pub fn save(handle: &tauri::AppHandle, data: &VaultData) -> Result<(), String> {
    let p = store_path(handle)?;
    save_to(&p, data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::dto::Bookmark;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Unique temp dir per test invocation (no `tempfile` dev-dep available).
    fn temp_dir() -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "pilpod_vault_test_{}_{}_{}",
            std::process::id(),
            super::super::now_ms(),
            n
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample() -> VaultData {
        let mut d = VaultData::default();
        d.bookmarks.push(Bookmark {
            id: "b_1".into(),
            url: "https://example.com".into(),
            normalized_url: "https://example.com".into(),
            title: "Example".into(),
            favicon_url: None,
            source_os_browser_id: None,
            source_profile_label: None,
            created_at_ms: 1,
            last_opened_at_ms: None,
            open_count: 0,
            pinned: false,
            tags: vec![],
            notes: None,
            collection_ids: vec![],
        });
        d
    }

    #[test]
    fn missing_file_loads_empty() {
        let dir = temp_dir();
        let p = dir.join("vault_store.json");
        let d = load_from(&p);
        assert_eq!(d, VaultData::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = temp_dir();
        let p = dir.join("vault_store.json");
        let d = sample();
        save_to(&p, &d).unwrap();
        assert_eq!(load_from(&p), d);
    }

    #[test]
    fn save_leaves_no_tmp_behind() {
        let dir = temp_dir();
        let p = dir.join("vault_store.json");
        save_to(&p, &sample()).unwrap();
        assert!(!tmp_path(&p).exists(), "tmp file should be renamed away");
        assert!(p.exists());
    }

    #[test]
    fn corrupt_file_is_backed_up_and_starts_empty() {
        let dir = temp_dir();
        let p = dir.join("vault_store.json");
        std::fs::write(&p, "{ this is not json ]").unwrap();
        let d = load_from(&p);
        assert_eq!(d, VaultData::default());
        // Original moved aside; a .bak-* sibling now exists.
        let has_backup = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".bak-"));
        assert!(has_backup, "corrupt file should be backed up, not deleted");
    }

    #[test]
    fn future_version_is_backed_up_and_starts_empty() {
        let dir = temp_dir();
        let p = dir.join("vault_store.json");
        let future = format!(
            "{{\"version\": {}, \"bookmarks\": [], \"mediaItems\": [], \"playlists\": []}}",
            STORE_VERSION + 1
        );
        std::fs::write(&p, future).unwrap();
        let d = load_from(&p);
        assert_eq!(d, VaultData::default());
        let has_backup = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".bak-"));
        assert!(has_backup);
    }
}
