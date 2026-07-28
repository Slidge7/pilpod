//! The only file that touches activation's on-disk representation.
//!
//! Single versioned JSON file at `{app_data_dir}/browser_activation.json`,
//! loaded whole at startup and rewritten atomically (temp + rename) whenever a
//! transition actually changes something. Following `vault/store.rs`: a corrupt
//! file is moved aside rather than silently destroyed, and load never fails.
//!
//! **Legacy migration.** The previous design persisted a flat
//! `browser_ext_state.json` of `{ "chrome": true }`. On first load, any `true`
//! entry becomes [`ActivationState::Active`] so existing users are not asked to
//! re-install an extension they already have. The legacy file is left in place
//! (harmless, and useful for support) but is only ever read once — after the new
//! file exists, migration is skipped.
//!
//! Time is injected (`now_ms` parameters) so the whole module is testable
//! without sleeping or mocking the system clock.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::activation::{advance, ActivationEvent, ActivationState};

const FILE_NAME: &str = "browser_activation.json";
const LEGACY_FILE_NAME: &str = "browser_ext_state.json";

/// Bump only for breaking shape changes; a newer-than-known file is quarantined.
pub const STORE_VERSION: u32 = 1;

/// What we remember about one OS browser.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationRecord {
    pub state: ActivationState,
    /// First time this browser was ever verified. Survives revoke → re-activate,
    /// so "connected since" copy stays truthful across extension reinstalls.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_activated_at: Option<u64>,
    /// Most recent verified handshake.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_verified_at: Option<u64>,
}

/// Serialized shape of the whole file. `BTreeMap` so the on-disk key order is
/// stable — otherwise every save produces a spurious diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationData {
    pub version: u32,
    #[serde(default)]
    pub browsers: BTreeMap<String, ActivationRecord>,
    /// User dismissed the first-run onboarding gate. Lives here rather than in
    /// the frontend's `localStorage` so it survives a webview data wipe and so
    /// Rust stays the single source of truth for setup state.
    #[serde(default)]
    pub onboarding_dismissed: bool,
}

impl Default for ActivationData {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            browsers: BTreeMap::new(),
            onboarding_dismissed: false,
        }
    }
}

/// In-memory store plus the path it persists to.
#[derive(Debug, Default)]
pub struct ActivationStore {
    data: ActivationData,
    path: PathBuf,
}

impl ActivationStore {
    /// Build from already-loaded data (used by tests and by [`load_from`]).
    pub fn new(data: ActivationData, path: PathBuf) -> Self {
        Self { data, path }
    }

    /// Store + legacy file names, resolved against an app-data directory.
    /// Kept here so `FILE_NAME` stays private to the one module that owns the
    /// on-disk format; `mod.rs` supplies the directory from the Tauri handle.
    pub fn paths_in(dir: &Path) -> (PathBuf, PathBuf) {
        (dir.join(FILE_NAME), dir.join(LEGACY_FILE_NAME))
    }

    // ── Reads ───────────────────────────────────────────────────────────────

    pub fn state_of(&self, browser_id: &str) -> ActivationState {
        self.data
            .browsers
            .get(browser_id)
            .map(|r| r.state)
            .unwrap_or_default()
    }

    pub fn record_of(&self, browser_id: &str) -> Option<&ActivationRecord> {
        self.data.browsers.get(browser_id)
    }

    pub fn is_active(&self, browser_id: &str) -> bool {
        self.state_of(browser_id).is_active()
    }

    pub fn data(&self) -> &ActivationData {
        &self.data
    }

    pub fn onboarding_dismissed(&self) -> bool {
        self.data.onboarding_dismissed
    }

    /// Cheap read-only copy for the browser-payload merge path, so the merge
    /// never has to hold (or even know about) the store lock.
    pub fn snapshot(&self) -> super::verify::ActivationSnapshot {
        self.data
            .browsers
            .iter()
            .map(|(id, rec)| (id.clone(), rec.state))
            .collect()
    }

    // ── Writes ──────────────────────────────────────────────────────────────

    /// Apply `event` to `browser_id`, persisting only on a real change.
    ///
    /// Returns `true` when anything changed (state *or* timestamps), which the
    /// caller uses to decide whether to re-emit `browsers://update`. A repeated
    /// handshake refreshes `last_verified_at` but is **not** reported as a
    /// change — heartbeats arrive every second and must not cause a disk write
    /// or a UI re-render each time.
    pub fn apply(&mut self, browser_id: &str, event: ActivationEvent, now_ms: u64) -> bool {
        let record = self
            .data
            .browsers
            .entry(browser_id.to_string())
            .or_default();

        let before = record.state;
        let after = advance(before, event);

        if matches!(event, ActivationEvent::HandshakeVerified) {
            record.last_verified_at = Some(now_ms);
            if record.first_activated_at.is_none() {
                record.first_activated_at = Some(now_ms);
            }
        }

        if before == after {
            return false;
        }

        record.state = after;
        if matches!(event, ActivationEvent::Reset) {
            record.first_activated_at = None;
            record.last_verified_at = None;
        }
        self.save();
        true
    }

    /// Record that the user dismissed (or re-armed) the first-run gate.
    /// `true` when the value changed.
    pub fn set_onboarding_dismissed(&mut self, dismissed: bool) -> bool {
        if self.data.onboarding_dismissed == dismissed {
            return false;
        }
        self.data.onboarding_dismissed = dismissed;
        self.save();
        true
    }

    /// Forget a browser entirely (dev-lab). `true` when an entry was removed.
    pub fn forget(&mut self, browser_id: &str) -> bool {
        if self.data.browsers.remove(browser_id).is_none() {
            return false;
        }
        self.save();
        true
    }

    fn save(&self) {
        if self.path.as_os_str().is_empty() {
            return; // in-memory store (tests)
        }
        if let Err(e) = save_to(&self.path, &self.data) {
            log::warn!("[extension-setup] persist failed: {e}");
        }
    }
}

// ── Free functions (the testable seam) ──────────────────────────────────────

/// Load `path`, falling back to a one-time migration of `legacy_path`.
///
/// Never fails: missing ⇒ empty (after migration attempt); corrupt or
/// future-versioned ⇒ backed up and empty.
pub fn load_from(path: &Path, legacy_path: &Path) -> ActivationStore {
    match std::fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<ActivationData>(&raw) {
            Ok(data) if data.version <= STORE_VERSION => {
                ActivationStore::new(data, path.to_path_buf())
            }
            Ok(_) | Err(_) => {
                backup_corrupt(path);
                ActivationStore::new(ActivationData::default(), path.to_path_buf())
            }
        },
        Err(_) => {
            // No new-format file yet — this is the one moment migration runs.
            let data = migrate_legacy_file(legacy_path);
            let store = ActivationStore::new(data, path.to_path_buf());
            if !store.data.browsers.is_empty() {
                store.save(); // freeze the migration so it never runs twice
            }
            store
        }
    }
}

/// Atomic write: serialize to `<file>.tmp`, then rename over the original, so a
/// crash mid-write can never leave a truncated file.
pub fn save_to(path: &Path, data: &ActivationData) -> Result<(), String> {
    let json = serde_json::to_string_pretty(data).map_err(|e| format!("serialize: {e}"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("create_dir_all: {e}"))?;
    }
    let tmp = tmp_path(path);
    std::fs::write(&tmp, json).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))
}

/// Pure part of the migration: legacy `{id: bool}` ⇒ activation records.
/// `true` ⇒ `Active` (they demonstrably had it working). `false` ⇒ dropped, since
/// an absent entry already means `Inactive`.
pub fn migrate_legacy_map(legacy: &BTreeMap<String, bool>) -> ActivationData {
    let browsers = legacy
        .iter()
        .filter(|(_, installed)| **installed)
        .map(|(id, _)| {
            (
                id.clone(),
                ActivationRecord {
                    state: ActivationState::Active,
                    // Timestamps are genuinely unknown for migrated rows; `None`
                    // is honest and the UI renders "connected" without a date.
                    first_activated_at: None,
                    last_verified_at: None,
                },
            )
        })
        .collect();
    ActivationData {
        version: STORE_VERSION,
        browsers,
        onboarding_dismissed: false,
    }
}

fn migrate_legacy_file(legacy_path: &Path) -> ActivationData {
    let Ok(raw) = std::fs::read_to_string(legacy_path) else {
        return ActivationData::default();
    };
    match serde_json::from_str::<BTreeMap<String, bool>>(&raw) {
        Ok(legacy) => {
            let data = migrate_legacy_map(&legacy);
            log::info!(
                "[extension-setup] migrated {} browser(s) from {LEGACY_FILE_NAME}",
                data.browsers.len()
            );
            data
        }
        Err(e) => {
            log::warn!("[extension-setup] legacy file unreadable ({e}) — starting empty");
            ActivationData::default()
        }
    }
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_else(|| FILE_NAME.into());
    name.push(".tmp");
    path.with_file_name(name)
}

fn backup_corrupt(path: &Path) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_else(|| FILE_NAME.into());
    name.push(format!(".bak-{ts}"));
    let dest = path.with_file_name(name);
    match std::fs::rename(path, &dest) {
        Ok(()) => log::warn!(
            "[extension-setup] corrupt store backed up to {} — starting empty",
            dest.display()
        ),
        Err(e) => log::warn!("[extension-setup] could not back up corrupt store: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::ActivationEvent as E;
    use super::ActivationState as S;
    use super::*;

    /// Scratch directory under the OS temp dir, unique per test.
    fn scratch(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("pilpod-activation-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn mem_store() -> ActivationStore {
        ActivationStore::new(ActivationData::default(), PathBuf::new())
    }

    // ── Reads / defaults ────────────────────────────────────────────────────

    #[test]
    fn unknown_browser_defaults_to_inactive() {
        let store = mem_store();
        assert_eq!(store.state_of("chrome"), S::Inactive);
        assert!(!store.is_active("chrome"));
        assert!(store.record_of("chrome").is_none());
    }

    // ── apply() semantics ───────────────────────────────────────────────────

    #[test]
    fn apply_reports_only_real_changes() {
        let mut store = mem_store();
        assert!(store.apply("chrome", E::SetupStarted, 1_000));
        assert_eq!(store.state_of("chrome"), S::SetupPending);
        // Same event again is a no-op — no write, no UI churn.
        assert!(!store.apply("chrome", E::SetupStarted, 2_000));
    }

    #[test]
    fn repeat_handshake_refreshes_timestamp_without_reporting_change() {
        let mut store = mem_store();
        assert!(store.apply("chrome", E::HandshakeVerified, 1_000));
        // Heartbeats land every second; they must not churn the UI or the disk.
        assert!(!store.apply("chrome", E::HandshakeVerified, 5_000));
        let rec = store.record_of("chrome").unwrap();
        assert_eq!(rec.state, S::Active);
        assert_eq!(rec.last_verified_at, Some(5_000));
    }

    #[test]
    fn first_activated_at_survives_revoke_and_reactivate() {
        let mut store = mem_store();
        store.apply("chrome", E::HandshakeVerified, 1_000);
        store.apply("chrome", E::ExtensionLost { grace_expired: true }, 2_000);
        assert_eq!(store.state_of("chrome"), S::Revoked);

        store.apply("chrome", E::HandshakeVerified, 9_000);
        let rec = store.record_of("chrome").unwrap();
        assert_eq!(rec.state, S::Active);
        assert_eq!(rec.first_activated_at, Some(1_000), "original date preserved");
        assert_eq!(rec.last_verified_at, Some(9_000));
    }

    #[test]
    fn reset_clears_timestamps() {
        let mut store = mem_store();
        store.apply("chrome", E::HandshakeVerified, 1_000);
        assert!(store.apply("chrome", E::Reset, 2_000));
        let rec = store.record_of("chrome").unwrap();
        assert_eq!(rec.state, S::Inactive);
        assert_eq!(rec.first_activated_at, None);
        assert_eq!(rec.last_verified_at, None);
    }

    #[test]
    fn apply_is_isolated_per_browser() {
        let mut store = mem_store();
        store.apply("chrome", E::HandshakeVerified, 1_000);
        assert!(store.is_active("chrome"));
        assert_eq!(store.state_of("msedge"), S::Inactive);
        assert_eq!(store.state_of("brave"), S::Inactive);
    }

    #[test]
    fn forget_removes_the_entry() {
        let mut store = mem_store();
        store.apply("chrome", E::HandshakeVerified, 1);
        assert!(store.forget("chrome"));
        assert!(!store.forget("chrome"), "second forget is a no-op");
        assert_eq!(store.state_of("chrome"), S::Inactive);
    }

    #[test]
    fn onboarding_dismissal_is_idempotent_and_persisted() {
        let dir = scratch("dismiss");
        let path = dir.join(FILE_NAME);
        let legacy = dir.join(LEGACY_FILE_NAME);

        let mut store = ActivationStore::new(ActivationData::default(), path.clone());
        assert!(!store.onboarding_dismissed());
        assert!(store.set_onboarding_dismissed(true));
        assert!(!store.set_onboarding_dismissed(true), "no-op second time");

        assert!(load_from(&path, &legacy).onboarding_dismissed());
    }

    #[test]
    fn older_files_without_the_dismissal_field_still_load() {
        let dir = scratch("nodismissfield");
        let path = dir.join(FILE_NAME);
        std::fs::write(
            &path,
            r#"{"version":1,"browsers":{"chrome":{"state":"active"}}}"#,
        )
        .unwrap();

        let store = load_from(&path, &dir.join(LEGACY_FILE_NAME));
        assert_eq!(store.state_of("chrome"), S::Active);
        assert!(!store.onboarding_dismissed());
    }

    // ── Persistence ─────────────────────────────────────────────────────────

    #[test]
    fn round_trips_through_disk() {
        let dir = scratch("roundtrip");
        let path = dir.join(FILE_NAME);
        let legacy = dir.join(LEGACY_FILE_NAME);

        let mut store = ActivationStore::new(ActivationData::default(), path.clone());
        store.apply("chrome", E::HandshakeVerified, 1_234);
        store.apply("msedge", E::SetupStarted, 1_300);

        let reloaded = load_from(&path, &legacy);
        assert_eq!(reloaded.state_of("chrome"), S::Active);
        assert_eq!(reloaded.state_of("msedge"), S::SetupPending);
        assert_eq!(
            reloaded.record_of("chrome").unwrap().first_activated_at,
            Some(1_234)
        );
        assert_eq!(reloaded.data(), store.data());
    }

    #[test]
    fn missing_file_yields_empty_store_not_an_error() {
        let dir = scratch("missing");
        let store = load_from(&dir.join(FILE_NAME), &dir.join(LEGACY_FILE_NAME));
        assert!(store.data().browsers.is_empty());
        assert_eq!(store.state_of("chrome"), S::Inactive);
    }

    #[test]
    fn corrupt_file_is_backed_up_and_store_starts_empty() {
        let dir = scratch("corrupt");
        let path = dir.join(FILE_NAME);
        std::fs::write(&path, "{ this is not json").unwrap();

        let store = load_from(&path, &dir.join(LEGACY_FILE_NAME));
        assert!(store.data().browsers.is_empty());

        let backups: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains(".bak-"))
            .collect();
        assert_eq!(backups.len(), 1, "corrupt file must be preserved, not deleted");
    }

    #[test]
    fn future_version_is_quarantined() {
        let dir = scratch("future");
        let path = dir.join(FILE_NAME);
        std::fs::write(
            &path,
            r#"{"version":999,"browsers":{"chrome":{"state":"active"}}}"#,
        )
        .unwrap();

        let store = load_from(&path, &dir.join(LEGACY_FILE_NAME));
        assert!(
            store.data().browsers.is_empty(),
            "a file written by a newer build must not be half-understood"
        );
    }

    #[test]
    fn no_tmp_file_is_left_behind() {
        let dir = scratch("tmp");
        let path = dir.join(FILE_NAME);
        let mut store = ActivationStore::new(ActivationData::default(), path.clone());
        store.apply("chrome", E::HandshakeVerified, 1);
        assert!(!tmp_path(&path).exists());
        assert!(path.exists());
    }

    // ── Legacy migration ────────────────────────────────────────────────────

    #[test]
    fn migrate_legacy_map_activates_only_true_entries() {
        let legacy: BTreeMap<String, bool> = [
            ("chrome".to_string(), true),
            ("msedge".to_string(), true),
            ("brave".to_string(), false),
        ]
        .into_iter()
        .collect();

        let data = migrate_legacy_map(&legacy);
        assert_eq!(data.version, STORE_VERSION);
        assert_eq!(data.browsers.len(), 2);
        assert_eq!(data.browsers["chrome"].state, S::Active);
        assert_eq!(data.browsers["msedge"].state, S::Active);
        assert!(
            !data.browsers.contains_key("brave"),
            "false entries are dropped — absent already means Inactive"
        );
    }

    #[test]
    fn legacy_file_migrates_on_first_load_and_is_frozen() {
        let dir = scratch("migrate");
        let path = dir.join(FILE_NAME);
        let legacy = dir.join(LEGACY_FILE_NAME);
        std::fs::write(&legacy, r#"{"chrome":true,"brave":false}"#).unwrap();

        let store = load_from(&path, &legacy);
        assert_eq!(store.state_of("chrome"), S::Active);
        assert_eq!(store.state_of("brave"), S::Inactive);
        assert!(path.exists(), "migration must be written through immediately");

        // Migration is one-shot: changing the legacy file afterwards is ignored.
        std::fs::write(&legacy, r#"{"vivaldi":true}"#).unwrap();
        let again = load_from(&path, &legacy);
        assert_eq!(again.state_of("vivaldi"), S::Inactive);
        assert_eq!(again.state_of("chrome"), S::Active);
    }

    #[test]
    fn unreadable_legacy_file_does_not_break_startup() {
        let dir = scratch("badlegacy");
        std::fs::write(dir.join(LEGACY_FILE_NAME), "not json at all").unwrap();
        let store = load_from(&dir.join(FILE_NAME), &dir.join(LEGACY_FILE_NAME));
        assert!(store.data().browsers.is_empty());
    }

    #[test]
    fn empty_legacy_file_writes_nothing() {
        let dir = scratch("emptylegacy");
        let path = dir.join(FILE_NAME);
        std::fs::write(dir.join(LEGACY_FILE_NAME), "{}").unwrap();
        let store = load_from(&path, &dir.join(LEGACY_FILE_NAME));
        assert!(store.data().browsers.is_empty());
        assert!(!path.exists(), "nothing to migrate ⇒ no pointless file");
    }

    // ── Wire format ─────────────────────────────────────────────────────────

    #[test]
    fn record_serializes_camel_case_and_omits_empty_timestamps() {
        let rec = ActivationRecord {
            state: S::Active,
            first_activated_at: Some(42),
            last_verified_at: None,
        };
        let json = serde_json::to_string(&rec).unwrap();
        assert!(json.contains("\"firstActivatedAt\":42"), "{json}");
        assert!(!json.contains("lastVerifiedAt"), "{json}");
    }
}
