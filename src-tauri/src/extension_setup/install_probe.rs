//! Is the companion installed in a browser — and if so, where, and is it on?
//!
//! The old probe answered one yes/no question by grepping profile folders for
//! the extension's *name*. That could not tell the setup flow what to do next:
//!
//! * **not installed**        → send the user to the Chrome Web Store listing
//! * **installed, disabled**  → send them to the browser's extensions page to switch it on
//! * **installed, enabled**   → it is there but not talking to PilPod (the desktop
//!   bridge is off by default and needs the user's consent), so open the
//!   companion's own **options page**, where the Connect button lives
//!
//! To answer that we read the browser's own record of installed extensions:
//! `extensions.settings.<id>` in each profile's `Secure Preferences` /
//! `Preferences` JSON. That entry is removed on uninstall, carries the enabled
//! state, and tells us the profile — which matters, because opening the
//! options page in the wrong profile shows "this page is blocked".
//!
//! Everything here is plain `std::fs` + `serde_json`, so it is platform-neutral
//! and unit-tested against fixture profiles in a temp dir. Only the list of
//! profile roots for a given browser is Windows-specific (`browser_os_scan`).

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use super::config;

/// Display name in the companion's manifest. Used only to recognise a
/// developer's unpacked copy, whose id differs from the store id.
pub const COMPANION_NAME: &str = "PilPod Companion";

/// Where the companion was found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompanionInstall {
    /// The id it is installed under — the store id, or an unpacked dev id.
    pub extension_id: String,
    /// Profile folder name (`"Default"`, `"Profile 2"`), passed to the browser as
    /// `--profile-directory`. `None` for browsers whose root *is* the profile
    /// (Opera), where the flag means nothing.
    pub profile_dir: Option<String>,
    /// False when the browser has it switched off.
    pub enabled: bool,
}

/// The three install situations the setup UI distinguishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallState {
    #[default]
    NotInstalled,
    /// Installed but switched off in the browser.
    Disabled,
    /// Installed and enabled.
    Installed,
}

impl InstallState {
    pub fn of(install: Option<&CompanionInstall>) -> Self {
        match install {
            None => Self::NotInstalled,
            Some(i) if i.enabled => Self::Installed,
            Some(_) => Self::Disabled,
        }
    }
}

// ── Preferences parsing (pure) ──────────────────────────────────────────────

/// One `extensions.settings.<id>` entry, as far as we care.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PrefsEntry {
    id: String,
    enabled: bool,
    /// `chrome.runtime.setUninstallURL` value. The companion puts its
    /// `browserId` UUID in it, which is how a profile folder is tied to a
    /// live bridge connection (see `browser_profiles`).
    uninstall_url: Option<String>,
}

/// Does this settings entry describe an actual install (rather than a stub some
/// browsers leave behind holding only permissions or a blocklist flag)?
fn looks_installed(entry: &Value) -> bool {
    ["path", "location", "manifest", "install_time", "first_install_time", "from_webstore"]
        .iter()
        .any(|k| entry.get(*k).is_some())
}

/// Enabled unless the browser recorded a reason it is not.
///
/// Older Chromium writes `"state": 0|1`; current Chromium drops `state` and
/// writes `disable_reasons`, as a bitmask int or (newest) a list.
fn entry_enabled(entry: &Value) -> bool {
    if entry.get("state").and_then(Value::as_i64) == Some(0) {
        return false;
    }
    match entry.get("disable_reasons") {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) == 0,
        Some(Value::Array(a)) => a.is_empty(),
        _ => true,
    }
}

/// Is this entry the companion? The store id always is; any other id only if it
/// is an unpacked copy whose manifest carries our name.
fn entry_is_companion(id: &str, entry: &Value, profile: &Path) -> bool {
    if id == config::EXTENSION_ID {
        return true;
    }
    if entry
        .pointer("/manifest/name")
        .and_then(Value::as_str)
        .is_some_and(|n| n == COMPANION_NAME)
    {
        return true;
    }
    // Unpacked installs record an absolute folder path; store installs a path
    // relative to `<profile>/Extensions`.
    let Some(path) = entry.get("path").and_then(Value::as_str) else {
        return false;
    };
    let p = Path::new(path);
    let dir = if p.is_absolute() {
        p.to_path_buf()
    } else {
        profile.join("Extensions").join(p)
    };
    manifest_name_is_companion(&dir.join("manifest.json"))
}

fn manifest_name_is_companion(manifest: &Path) -> bool {
    std::fs::read_to_string(manifest)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("name").and_then(Value::as_str).map(|n| n == COMPANION_NAME))
        .unwrap_or(false)
}

/// Companion entries in one parsed preferences document.
fn companion_entries(prefs: &Value, profile: &Path) -> Vec<PrefsEntry> {
    let Some(settings) = prefs.pointer("/extensions/settings").and_then(Value::as_object) else {
        return Vec::new();
    };
    settings
        .iter()
        .filter(|(_, e)| looks_installed(e))
        .filter(|(id, e)| entry_is_companion(id, e, profile))
        .map(|(id, e)| PrefsEntry {
            id: id.clone(),
            enabled: entry_enabled(e),
            uninstall_url: e
                .get("uninstall_url")
                .and_then(Value::as_str)
                .filter(|u| !u.is_empty())
                .map(str::to_string),
        })
        .collect()
}

fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

// ── Profile scanning ────────────────────────────────────────────────────────

/// Probe one profile folder. `profile_dir` is what we would pass back to the
/// browser as `--profile-directory`.
pub fn probe_profile(profile: &Path, profile_dir: Option<&str>) -> Option<CompanionInstall> {
    best(profile_entries(profile).into_iter().map(|e| CompanionInstall {
        extension_id: e.id,
        profile_dir: profile_dir.map(str::to_string),
        enabled: e.enabled,
    }))
}

/// The companion as recorded in one profile, including the uninstall URL that
/// carries its `browserId`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompanionMarker {
    pub extension_id: String,
    pub enabled: bool,
    pub uninstall_url: Option<String>,
}

/// Like [`probe_profile`], but keeps the uninstall URL. Same preference
/// (enabled first, then the store build).
pub fn probe_profile_marker(profile: &Path) -> Option<CompanionMarker> {
    profile_entries(profile)
        .into_iter()
        .max_by_key(|e| (e.enabled, e.id == config::EXTENSION_ID))
        .map(|e| CompanionMarker {
            extension_id: e.id,
            enabled: e.enabled,
            uninstall_url: e.uninstall_url,
        })
}

/// Every companion entry in one profile, both preference files merged.
fn profile_entries(profile: &Path) -> Vec<PrefsEntry> {
    // Chromium on Windows keeps extension settings in `Secure Preferences`;
    // other builds (and some forks) in `Preferences`. An entry in either counts,
    // and a "disabled" in either wins — the two files are merged at runtime.
    let mut found: Vec<PrefsEntry> = Vec::new();
    for name in ["Secure Preferences", "Preferences"] {
        if let Some(v) = read_json(&profile.join(name)) {
            for e in companion_entries(&v, profile) {
                match found.iter_mut().find(|f| f.id == e.id) {
                    Some(f) => {
                        f.enabled &= e.enabled;
                        if f.uninstall_url.is_none() {
                            f.uninstall_url = e.uninstall_url;
                        }
                    }
                    None => found.push(e),
                }
            }
        }
    }

    // Last resort: the store build's files are on disk but neither prefs file
    // could be parsed (browser mid-write, unusual fork). Treat as enabled — if
    // it is actually off, the options page simply won't load and the guide
    // offers the extensions page next.
    if found.is_empty() && profile.join("Extensions").join(config::EXTENSION_ID).is_dir() {
        found.push(PrefsEntry {
            id: config::EXTENSION_ID.to_string(),
            enabled: true,
            uninstall_url: None,
        });
    }
    found
}

/// Prefer an enabled install, then the store build over a dev copy.
fn best(candidates: impl Iterator<Item = CompanionInstall>) -> Option<CompanionInstall> {
    candidates.max_by_key(|c| (c.enabled, c.extension_id == config::EXTENSION_ID))
}

fn is_profile_dir_name(name: &str) -> bool {
    let n = name.to_lowercase();
    n == "default" || n.starts_with("profile ") || n.starts_with("profile_")
}

/// Probe every profile under a Chromium "User Data"-style root. Handles both
/// layouts: profiles as sub-folders (Chrome, Edge, Brave…) and the root being
/// the profile itself (Opera).
pub fn probe_root(root: &Path) -> Option<CompanionInstall> {
    if !root.is_dir() {
        return None;
    }
    let mut candidates: Vec<CompanionInstall> = Vec::new();

    if root.join("Preferences").is_file() || root.join("Secure Preferences").is_file() {
        candidates.extend(probe_profile(root, None));
    }

    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let lower = name.to_lowercase();
            if lower == "system profile" || lower == "guest profile" || lower.starts_with("snapshots") {
                continue;
            }
            let path = entry.path();
            if is_profile_dir_name(&name) || path.join("Preferences").is_file() {
                candidates.extend(probe_profile(&path, Some(&name)));
            }
        }
    }

    best(candidates.into_iter())
}

/// Probe a browser by OS id. Windows resolves the profile roots; elsewhere
/// there is nothing to probe.
pub fn probe_browser(browser_id: &str) -> Option<CompanionInstall> {
    #[cfg(windows)]
    {
        let roots: Vec<PathBuf> = crate::browser_os_scan::chromium_profile_roots(browser_id);
        best(roots.iter().filter_map(|r| probe_root(r)))
    }
    #[cfg(not(windows))]
    {
        let _ = browser_id;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    const ID: &str = config::EXTENSION_ID;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "pilpod-probe-{tag}-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_prefs(profile: &Path, file: &str, settings: Value) {
        fs::create_dir_all(profile).unwrap();
        let doc = json!({ "extensions": { "settings": settings } });
        fs::write(profile.join(file), doc.to_string()).unwrap();
    }

    fn store_entry() -> Value {
        json!({ "location": 1, "from_webstore": true, "path": format!("{ID}/2.1.0_0") })
    }

    #[test]
    fn nothing_installed_is_none() {
        let t = TempDir::new("none");
        write_prefs(&t.0.join("Default"), "Secure Preferences", json!({
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { "location": 1 }
        }));
        assert_eq!(probe_root(&t.0), None);
        assert_eq!(InstallState::of(None), InstallState::NotInstalled);
    }

    #[test]
    fn store_install_is_found_with_its_profile() {
        let t = TempDir::new("store");
        write_prefs(&t.0.join("Profile 2"), "Secure Preferences", json!({ ID: store_entry() }));
        let got = probe_root(&t.0).unwrap();
        assert_eq!(got.extension_id, ID);
        assert_eq!(got.profile_dir.as_deref(), Some("Profile 2"));
        assert!(got.enabled);
        assert_eq!(InstallState::of(Some(&got)), InstallState::Installed);
    }

    #[test]
    fn disable_reasons_int_and_list_and_legacy_state_mean_disabled() {
        for extra in [
            json!({ "disable_reasons": 1 }),
            json!({ "disable_reasons": [1] }),
            json!({ "state": 0 }),
        ] {
            let t = TempDir::new("disabled");
            let mut e = store_entry();
            e.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            write_prefs(&t.0.join("Default"), "Secure Preferences", json!({ ID: e }));
            let got = probe_root(&t.0).unwrap();
            assert!(!got.enabled, "{extra}");
            assert_eq!(InstallState::of(Some(&got)), InstallState::Disabled);
        }
    }

    #[test]
    fn zero_or_empty_disable_reasons_mean_enabled() {
        for extra in [json!({ "disable_reasons": 0 }), json!({ "disable_reasons": [] }), json!({ "state": 1 })] {
            let t = TempDir::new("enabled");
            let mut e = store_entry();
            e.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            write_prefs(&t.0.join("Default"), "Preferences", json!({ ID: e }));
            assert!(probe_root(&t.0).unwrap().enabled, "{extra}");
        }
    }

    #[test]
    fn a_stub_entry_is_not_an_install() {
        let t = TempDir::new("stub");
        write_prefs(&t.0.join("Default"), "Preferences", json!({ ID: { "active_permissions": {} } }));
        assert_eq!(probe_root(&t.0), None);
    }

    #[test]
    fn enabled_profile_beats_disabled_profile() {
        let t = TempDir::new("pick");
        let mut off = store_entry();
        off["disable_reasons"] = json!(1);
        write_prefs(&t.0.join("Default"), "Secure Preferences", json!({ ID: off }));
        write_prefs(&t.0.join("Profile 1"), "Secure Preferences", json!({ ID: store_entry() }));
        let got = probe_root(&t.0).unwrap();
        assert!(got.enabled);
        assert_eq!(got.profile_dir.as_deref(), Some("Profile 1"));
    }

    #[test]
    fn disabled_in_either_prefs_file_wins() {
        let t = TempDir::new("merge");
        let p = t.0.join("Default");
        write_prefs(&p, "Secure Preferences", json!({ ID: store_entry() }));
        let mut off = store_entry();
        off["disable_reasons"] = json!(1);
        write_prefs(&p, "Preferences", json!({ ID: off }));
        assert!(!probe_root(&t.0).unwrap().enabled);
    }

    #[test]
    fn unpacked_dev_copy_is_found_by_manifest_name() {
        let t = TempDir::new("dev");
        let src = t.0.join("src-ext");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("manifest.json"), json!({ "name": COMPANION_NAME }).to_string()).unwrap();
        let dev_id = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let root = t.0.join("User Data");
        write_prefs(&root.join("Default"), "Preferences", json!({
            dev_id: { "location": 4, "path": src.to_string_lossy() }
        }));
        let got = probe_root(&root).unwrap();
        assert_eq!(got.extension_id, dev_id);
    }

    #[test]
    fn opera_style_root_profile_has_no_profile_dir() {
        let t = TempDir::new("opera");
        write_prefs(&t.0, "Secure Preferences", json!({ ID: store_entry() }));
        let got = probe_root(&t.0).unwrap();
        assert_eq!(got.profile_dir, None);
    }

    #[test]
    fn files_on_disk_without_readable_prefs_still_count() {
        let t = TempDir::new("files");
        let p = t.0.join("Default");
        fs::create_dir_all(p.join("Extensions").join(ID).join("2.1.0_0")).unwrap();
        fs::write(p.join("Preferences"), "{ not json").unwrap();
        let got = probe_root(&t.0).unwrap();
        assert_eq!(got.extension_id, ID);
        assert!(got.enabled);
    }

    #[test]
    fn install_state_serializes_camel_case() {
        assert_eq!(serde_json::to_string(&InstallState::NotInstalled).unwrap(), "\"notInstalled\"");
        assert_eq!(serde_json::to_string(&InstallState::Disabled).unwrap(), "\"disabled\"");
        assert_eq!(serde_json::to_string(&InstallState::Installed).unwrap(), "\"installed\"");
    }

    #[test]
    fn marker_carries_uninstall_url_from_either_prefs_file() {
        let t = TempDir::new("marker");
        let p = t.0.join("Profile 3");
        let mut entry = store_entry();
        entry["uninstall_url"] = json!("http://127.0.0.1:17399/companion-removed?bid=abc");
        // Secure Preferences has the install, Preferences the URL: merged.
        write_prefs(&p, "Secure Preferences", json!({ ID: store_entry() }));
        write_prefs(&p, "Preferences", json!({ ID: entry }));
        let m = probe_profile_marker(&p).unwrap();
        assert_eq!(m.extension_id, ID);
        assert!(m.enabled);
        assert_eq!(
            m.uninstall_url.as_deref(),
            Some("http://127.0.0.1:17399/companion-removed?bid=abc")
        );
    }

    #[test]
    fn marker_is_none_without_companion() {
        let t = TempDir::new("marker-none");
        let p = t.0.join("Default");
        write_prefs(&p, "Secure Preferences", json!({
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { "location": 1, "uninstall_url": "https://x" }
        }));
        assert_eq!(probe_profile_marker(&p), None);
    }
}
