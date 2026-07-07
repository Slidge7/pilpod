//! Stable profile numbering — Phase 4.
//!
//! Each extension install (one per browser profile) has a stable UUID. The UI
//! wants friendly, *stable* labels ("Profile 1", "Profile 2") instead of UUID
//! prefixes. This store remembers the first-seen order of profile UUIDs per
//! OS browser id and persists it, so "Profile 2" stays "Profile 2" across
//! restarts and regardless of HashMap iteration order.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

/// First-seen profile UUID order per OS browser id.
#[derive(Default, Serialize, Deserialize)]
pub struct ProfileOrderStore {
    #[serde(flatten)]
    order: HashMap<String, Vec<String>>,

    #[serde(skip)]
    path: Option<PathBuf>,
}

impl ProfileOrderStore {
    /// In-memory store (tests, and before `init` runs).
    pub fn new_in_memory() -> Self {
        Self::default()
    }

    /// Load from `path`, or start empty. The file is created on first write.
    pub fn load(path: PathBuf) -> Self {
        let order: HashMap<String, Vec<String>> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            order,
            path: Some(path),
        }
    }

    /// 0-based position of `uuid` within `os_id`'s first-seen order.
    /// Unknown UUIDs are appended (and persisted).
    pub fn position(&mut self, os_id: &str, uuid: &str) -> usize {
        let list = self.order.entry(os_id.to_string()).or_default();
        if let Some(idx) = list.iter().position(|u| u == uuid) {
            return idx;
        }
        list.push(uuid.to_string());
        let idx = list.len() - 1;
        self.save();
        idx
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        if let Ok(json) = serde_json::to_string_pretty(&self.order) {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Err(e) = std::fs::write(path, json) {
                eprintln!("[profile-order] persist failed: {e}");
            }
        }
    }
}

// ── Process-global instance ──────────────────────────────────────────────────

static GLOBAL: LazyLock<Mutex<ProfileOrderStore>> =
    LazyLock::new(|| Mutex::new(ProfileOrderStore::new_in_memory()));

/// Point the global store at `{app_data_dir}/browser_profile_order.json`.
/// Call once at setup; safe to skip (falls back to in-memory ordering).
pub fn init(app_data_dir: PathBuf) {
    let store = ProfileOrderStore::load(app_data_dir.join("browser_profile_order.json"));
    if let Ok(mut global) = GLOBAL.lock() {
        *global = store;
    }
}

/// 1-based stable profile number for display ("Profile {n}").
pub fn profile_number(os_id: &str, uuid: &str) -> usize {
    GLOBAL
        .lock()
        .map(|mut store| store.position(os_id, uuid) + 1)
        .unwrap_or(1)
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_seen_order_is_stable() {
        let mut s = ProfileOrderStore::new_in_memory();
        assert_eq!(s.position("chrome", "uuid-b"), 0);
        assert_eq!(s.position("chrome", "uuid-a"), 1);
        // Re-query in any order: positions unchanged.
        assert_eq!(s.position("chrome", "uuid-a"), 1);
        assert_eq!(s.position("chrome", "uuid-b"), 0);
    }

    #[test]
    fn per_browser_namespaces_are_independent() {
        let mut s = ProfileOrderStore::new_in_memory();
        assert_eq!(s.position("chrome", "uuid-1"), 0);
        assert_eq!(s.position("brave", "uuid-2"), 0);
        assert_eq!(s.position("chrome", "uuid-2"), 1);
    }

    #[test]
    fn persists_and_reloads() {
        let dir = std::env::temp_dir().join(format!(
            "pilpod_profile_order_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("browser_profile_order.json");

        {
            let mut s = ProfileOrderStore::load(path.clone());
            assert_eq!(s.position("chrome", "uuid-x"), 0);
            assert_eq!(s.position("chrome", "uuid-y"), 1);
        }
        {
            let mut s = ProfileOrderStore::load(path.clone());
            // Known UUIDs keep their positions after reload.
            assert_eq!(s.position("chrome", "uuid-y"), 1);
            assert_eq!(s.position("chrome", "uuid-x"), 0);
            assert_eq!(s.position("chrome", "uuid-z"), 2);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn in_memory_store_never_touches_disk() {
        let mut s = ProfileOrderStore::new_in_memory();
        // No path → save is a no-op; position still works.
        assert_eq!(s.position("firefox", "uuid-1"), 0);
    }
}
