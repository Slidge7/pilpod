//! Browser profiles on disk — who each profile is (name, account email,
//! avatar picture, colour) and which companion install lives in it.
//!
//! # Why this exists
//!
//! The peer-PID binding (`browser_bridge::peer_pid`) tells Chrome from Brave,
//! but Chromium runs **every profile in one browser process**, so it cannot
//! tell two Chrome profiles apart. Each companion install does have its own
//! `browserId` UUID; this module ties that UUID to a profile folder:
//!
//! 1. **Who the profiles are** — Chromium's `User Data/Local State` lists every
//!    profile under `profile.info_cache` (display name, account, avatar file,
//!    highlight colour) and the open ones under `profile.last_active_profiles`.
//!    Firefox lists its profiles in `profiles.ini`.
//! 2. **Marker** — the companion calls
//!    `chrome.runtime.setUninstallURL("http://127.0.0.1:17399/companion-removed?bid=<uuid>")`.
//!    Chromium stores that under `extensions.settings.<id>.uninstall_url` in
//!    the profile's (Secure) Preferences, which `install_probe` already reads.
//! 3. **Storage** — companions older than the marker: the UUID also sits in the
//!    extension's own `chrome.storage.local` files
//!    (`<profile>/Local Extension Settings/<ext-id>/`). A byte search for a
//!    *known, live* UUID finds it without parsing LevelDB.
//! 4. **Inferred** — at merge time, one unlinked connection and one candidate
//!    profile can only be each other.
//!
//! Everything below the Windows root lookup is plain `std::fs` and is tested
//! against fixture folders.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::extension_setup::install_probe::{self, CompanionMarker};

/// Bridge HTTP path the companion's uninstall URL points at.
pub const UNINSTALL_PATH: &str = "/companion-removed";
/// Query key carrying the companion's `browserId` in that URL.
pub const UNINSTALL_BID_PARAM: &str = "bid";

/// Don't re-search a profile's extension storage for the same UUID more often.
const STORAGE_MISS_RETRY: Duration = Duration::from_secs(30);
/// Extension storage files bigger than this are skipped (ours are a few KB).
const STORAGE_FILE_MAX: u64 = 8 * 1024 * 1024;
/// Avatar pictures bigger than this are not sent to the UI.
const AVATAR_FILE_MAX: u64 = 2 * 1024 * 1024;

// ── Types ───────────────────────────────────────────────────────────────────

/// Companion state inside one profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileCompanion {
    #[default]
    NotInstalled,
    Disabled,
    Installed,
}

/// How a profile was tied to a companion `browserId`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileLink {
    /// Uninstall-URL marker in the profile's preferences.
    Marker,
    /// UUID found in the extension's own storage files.
    Storage,
    /// Only possible match: one unlinked connection, one candidate profile.
    Inferred,
}

/// One browser profile, as shown to the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileInfo {
    /// Profile folder (`"Default"`, `"Profile 2"`) — what `--profile-directory`
    /// takes. Empty when the browser's data folder is itself the profile
    /// (Opera). Firefox: the profile path from `profiles.ini`.
    pub dir: String,
    /// Name the browser shows for this profile ("Work", "Salah").
    pub name: String,
    /// Signed-in account email.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Signed-in account's full name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_name: Option<String>,
    /// Identifies the avatar picture; changes when the picture does. Fetch the
    /// image with `get_browser_profile_avatar`. `None` ⇒ no picture, draw an
    /// initial on [`Self::color`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_key: Option<String>,
    /// Profile theme colour, `#rrggbb`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// The profile the browser opens by default (used last).
    #[serde(default)]
    pub last_used: bool,
    /// The browser lists this profile as open (Chromium only).
    #[serde(default)]
    pub open: bool,
    #[serde(default)]
    pub companion: ProfileCompanion,
    /// Companion `browserId` living in this profile, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browser_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<ProfileLink>,
    /// PilPod can open this profile directly (`--profile-directory`).
    #[serde(default)]
    pub can_launch: bool,
}

/// Profiles per OS browser id (`"chrome"`, `"msedge"`…).
pub type ProfilesByBrowser = HashMap<String, Vec<BrowserProfileInfo>>;

/// A folder a browser keeps profiles in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileRoot {
    /// Chromium "User Data" (or Opera's root-is-profile folder).
    Chromium(PathBuf),
    /// Firefox-family folder holding `profiles.ini`.
    Firefox(PathBuf),
}

// ── Chromium `Local State` (pure) ───────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Default)]
struct LocalStateProfile {
    dir: String,
    name: String,
    email: Option<String>,
    account_name: Option<String>,
    /// File name of the account picture inside the profile folder.
    picture_file: Option<String>,
    color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default)]
struct LocalStateSummary {
    profiles: Vec<LocalStateProfile>,
    last_used: Option<String>,
    open: Vec<String>,
}

fn non_empty<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Name Chromium shows for a profile. A profile still on its default name
/// ("Person 1", "Profile 1") shows the signed-in account's first name instead.
fn profile_display_name(info: &Value, dir: &str) -> String {
    let using_default = info
        .get("is_using_default_name")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let account = non_empty(info, "gaia_given_name").or_else(|| non_empty(info, "gaia_name"));
    if using_default {
        if let Some(a) = account {
            return a.to_string();
        }
    }
    non_empty(info, "name")
        .or(account)
        .map(str::to_string)
        .unwrap_or_else(|| dir.to_string())
}

/// Chromium stores colours as signed 32-bit ARGB ints.
fn argb_to_hex(n: i64) -> Option<String> {
    if n < i64::from(i32::MIN) || n > i64::from(u32::MAX) {
        return None;
    }
    let v = n as u32;
    Some(format!("#{:06x}", v & 0x00FF_FFFF))
}

fn profile_color(info: &Value) -> Option<String> {
    ["profile_highlight_color", "default_avatar_fill_color", "profile_color_seed"]
        .iter()
        .find_map(|k| info.get(*k).and_then(Value::as_i64))
        .and_then(argb_to_hex)
}

/// Account picture file, unless the user deliberately picked a built-in avatar.
fn picture_file(info: &Value) -> Option<String> {
    let use_gaia = info.get("use_gaia_picture").and_then(Value::as_bool);
    let default_avatar = info.get("is_using_default_avatar").and_then(Value::as_bool);
    if use_gaia == Some(false) && default_avatar == Some(false) {
        return None;
    }
    non_empty(info, "gaia_picture_file_name").map(str::to_string)
}

fn is_hidden_dir(dir: &str) -> bool {
    let d = dir.to_lowercase();
    d == "system profile" || d == "guest profile"
}

/// `"Default"` first, then `"Profile N"` by number, then by name.
fn dir_sort_key(dir: &str) -> (u8, u64, String) {
    if dir.eq_ignore_ascii_case("default") {
        return (0, 0, String::new());
    }
    let num = dir
        .rsplit(' ')
        .next()
        .and_then(|n| n.parse::<u64>().ok());
    match num {
        Some(n) => (1, n, dir.to_lowercase()),
        None => (2, 0, dir.to_lowercase()),
    }
}

fn parse_local_state(v: &Value) -> LocalStateSummary {
    let mut profiles: Vec<LocalStateProfile> = v
        .pointer("/profile/info_cache")
        .and_then(Value::as_object)
        .map(|cache| {
            cache
                .iter()
                .filter(|(dir, _)| !is_hidden_dir(dir))
                .filter(|(_, info)| {
                    !info
                        .get("is_omitted_from_profile_list")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .map(|(dir, info)| LocalStateProfile {
                    dir: dir.clone(),
                    name: profile_display_name(info, dir),
                    email: non_empty(info, "user_name").map(str::to_string),
                    account_name: non_empty(info, "gaia_name").map(str::to_string),
                    picture_file: picture_file(info),
                    color: profile_color(info),
                })
                .collect()
        })
        .unwrap_or_default();
    profiles.sort_by_key(|p| dir_sort_key(&p.dir));

    let last_used = v
        .pointer("/profile/last_used")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let open = v
        .pointer("/profile/last_active_profiles")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();

    LocalStateSummary {
        profiles,
        last_used,
        open,
    }
}

// ── Marker (pure) ───────────────────────────────────────────────────────────

/// The `browserId` the companion put in its uninstall URL, if it is ours.
pub fn bid_from_uninstall_url(url: &str) -> Option<String> {
    let (path, query) = url.split_once('?')?;
    if !path.ends_with(UNINSTALL_PATH) {
        return None;
    }
    let query = query.split('#').next().unwrap_or("");
    query
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| *k == UNINSTALL_BID_PARAM)
        .map(|(_, v)| v.to_string())
        .filter(|v| is_plausible_browser_id(v))
}

/// UUIDs (and the extension's `b-<time>-<hex>` fallback) — nothing else.
fn is_plausible_browser_id(v: &str) -> bool {
    (8..=64).contains(&v.len())
        && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn companion_state(marker: Option<&CompanionMarker>) -> ProfileCompanion {
    match marker {
        None => ProfileCompanion::NotInstalled,
        Some(m) if m.enabled => ProfileCompanion::Installed,
        Some(_) => ProfileCompanion::Disabled,
    }
}

// ── Firefox `profiles.ini` (pure) ───────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
struct FirefoxProfile {
    name: String,
    /// Path as written in the ini (forward slashes when relative).
    path: String,
    is_relative: bool,
    is_default: bool,
}

fn parse_profiles_ini(text: &str) -> Vec<FirefoxProfile> {
    let mut out = Vec::new();
    let mut install_defaults: HashSet<String> = HashSet::new();
    let mut section = String::new();
    let mut cur: HashMap<String, String> = HashMap::new();

    let flush = |section: &str, cur: &mut HashMap<String, String>, out: &mut Vec<FirefoxProfile>, installs: &mut HashSet<String>| {
        if section.starts_with("Profile") {
            if let Some(path) = cur.get("Path").filter(|p| !p.is_empty()) {
                out.push(FirefoxProfile {
                    name: cur.get("Name").cloned().unwrap_or_else(|| path.clone()),
                    path: path.clone(),
                    is_relative: cur.get("IsRelative").map(|v| v == "1").unwrap_or(true),
                    is_default: cur.get("Default").map(|v| v == "1").unwrap_or(false),
                });
            }
        } else if section.starts_with("Install") {
            if let Some(d) = cur.get("Default") {
                installs.insert(d.clone());
            }
        }
        cur.clear();
    };

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            flush(&section, &mut cur, &mut out, &mut install_defaults);
            section = line[1..line.len() - 1].to_string();
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            cur.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    flush(&section, &mut cur, &mut out, &mut install_defaults);

    // Newer Firefox records the real default per install; it beats `Default=1`.
    if !install_defaults.is_empty() {
        for p in &mut out {
            p.is_default = install_defaults.contains(&p.path);
        }
    }
    out
}

// ── Merge-time linking (pure) ───────────────────────────────────────────────

/// Tie live connections (`slot_ids`) to one browser's profiles. Profiles whose
/// marker/storage UUID is live are linked already; then, if exactly one
/// connection is left and exactly one profile could hold it, they are paired
/// ([`ProfileLink::Inferred`]). Returns `slot id → profile index`.
pub fn link_slots(profiles: &mut [BrowserProfileInfo], slot_ids: &[&str]) -> HashMap<String, usize> {
    let live: HashSet<&str> = slot_ids.iter().copied().collect();
    let mut out: HashMap<String, usize> = HashMap::new();
    for (i, p) in profiles.iter().enumerate() {
        if let Some(id) = p.browser_id.as_deref() {
            if live.contains(id) {
                out.entry(id.to_string()).or_insert(i);
            }
        }
    }

    let unlinked: Vec<&str> = slot_ids
        .iter()
        .copied()
        .filter(|id| !out.contains_key(*id))
        .collect();
    if unlinked.len() != 1 {
        return out;
    }

    // A profile is free when it has no UUID, or a UUID that is not connected
    // (stale marker: storage cleared, extension reinstalled).
    let linked_idx: HashSet<usize> = out.values().copied().collect();
    let free: Vec<usize> = (0..profiles.len())
        .filter(|i| !linked_idx.contains(i))
        .filter(|i| !matches!(profiles[*i].browser_id.as_deref(), Some(id) if live.contains(id)))
        .collect();
    let with_companion: Vec<usize> = free
        .iter()
        .copied()
        .filter(|i| profiles[*i].companion != ProfileCompanion::NotInstalled)
        .collect();

    let pick = match (with_companion.len(), profiles.len(), free.len()) {
        (1, _, _) => Some(with_companion[0]),
        // A browser with one profile: the connection must be from it, even
        // when the companion entry could not be read (Firefox, odd forks).
        (0, 1, 1) => Some(free[0]),
        _ => None,
    };
    if let Some(i) = pick {
        let id = unlinked[0].to_string();
        profiles[i].browser_id = Some(id.clone());
        profiles[i].link = Some(ProfileLink::Inferred);
        out.insert(id, i);
    }
    out
}

// ── Scanning with a file-stamp cache ────────────────────────────────────────

type Stamp = Option<(SystemTime, u64)>;

fn stamp(path: &Path) -> Stamp {
    let m = std::fs::metadata(path).ok()?;
    Some((m.modified().ok()?, m.len()))
}

#[derive(Default)]
struct ScanCache {
    local_state: HashMap<PathBuf, (Stamp, LocalStateSummary)>,
    markers: HashMap<PathBuf, ((Stamp, Stamp), Option<CompanionMarker>)>,
    firefox_ini: HashMap<PathBuf, (Stamp, Vec<FirefoxProfile>)>,
    firefox_ext: HashMap<PathBuf, (Stamp, bool)>,
    /// Profile folder → UUID found in its extension storage (stable per install).
    storage_hits: HashMap<PathBuf, String>,
    storage_misses: HashMap<(PathBuf, String), Instant>,
    /// Avatar key → picture path (for `avatar_data_url`).
    avatars: HashMap<String, PathBuf>,
}

impl ScanCache {
    fn local_state(&mut self, root: &Path) -> LocalStateSummary {
        let path = root.join("Local State");
        let st = stamp(&path);
        if let Some((s, v)) = self.local_state.get(&path) {
            if *s == st {
                return v.clone();
            }
        }
        let v = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .map(|v| parse_local_state(&v))
            .unwrap_or_default();
        self.local_state.insert(path, (st, v.clone()));
        v
    }

    fn marker(&mut self, profile: &Path) -> Option<CompanionMarker> {
        let st = (
            stamp(&profile.join("Secure Preferences")),
            stamp(&profile.join("Preferences")),
        );
        if let Some((s, m)) = self.markers.get(profile) {
            if *s == st {
                return m.clone();
            }
        }
        let m = install_probe::probe_profile_marker(profile);
        self.markers.insert(profile.to_path_buf(), (st, m.clone()));
        m
    }

    fn firefox_profiles(&mut self, base: &Path) -> Vec<FirefoxProfile> {
        let path = base.join("profiles.ini");
        let st = stamp(&path);
        if let Some((s, v)) = self.firefox_ini.get(&path) {
            if *s == st {
                return v.clone();
            }
        }
        let v = std::fs::read_to_string(&path)
            .map(|t| parse_profiles_ini(&t))
            .unwrap_or_default();
        self.firefox_ini.insert(path, (st, v.clone()));
        v
    }

    fn firefox_has_companion(&mut self, profile: &Path) -> bool {
        let path = profile.join("extensions.json");
        let st = stamp(&path);
        if let Some((s, v)) = self.firefox_ext.get(&path) {
            if *s == st {
                return *v;
            }
        }
        let v = std::fs::read_to_string(&path)
            .map(|t| t.contains(install_probe::COMPANION_NAME))
            .unwrap_or(false);
        self.firefox_ext.insert(path, (st, v));
        v
    }

    fn avatar_key(&mut self, os_id: &str, dir: &str, picture: &Path) -> Option<String> {
        let (mtime, len) = stamp(picture)?;
        if len == 0 || len > AVATAR_FILE_MAX {
            return None;
        }
        let ms = mtime
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let key = format!("{os_id}|{dir}|{ms}|{len}");
        self.avatars.insert(key.clone(), picture.to_path_buf());
        Some(key)
    }

    /// Is one of `uuids` in this profile's companion storage? Results are
    /// remembered: hits for good, misses for [`STORAGE_MISS_RETRY`].
    fn storage_uuid(&mut self, profile: &Path, ext_id: &str, uuids: &[&str], now: Instant) -> Option<String> {
        if let Some(hit) = self.storage_hits.get(profile) {
            if uuids.contains(&hit.as_str()) {
                return Some(hit.clone());
            }
        }
        let dir = profile.join("Local Extension Settings").join(ext_id);
        let mut files: Option<Vec<Vec<u8>>> = None;
        for uuid in uuids {
            let key = (profile.to_path_buf(), (*uuid).to_string());
            if let Some(t) = self.storage_misses.get(&key) {
                if now.duration_since(*t) < STORAGE_MISS_RETRY {
                    continue;
                }
            }
            let data = files.get_or_insert_with(|| read_storage_files(&dir));
            if data.iter().any(|f| contains_bytes(f, uuid.as_bytes())) {
                self.storage_hits.insert(profile.to_path_buf(), (*uuid).to_string());
                return Some((*uuid).to_string());
            }
            self.storage_misses.insert(key, now);
        }
        None
    }
}

fn read_storage_files(dir: &Path) -> Vec<Vec<u8>> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_lowercase();
            n.ends_with(".log") || n.ends_with(".ldb")
        })
        .filter(|e| e.metadata().map(|m| m.len() <= STORAGE_FILE_MAX).unwrap_or(false))
        .filter_map(|e| std::fs::read(e.path()).ok())
        .collect()
}

fn contains_bytes(hay: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && hay.windows(needle.len()).any(|w| w == needle)
}

/// Profiles under one Chromium root.
fn scan_chromium_root(
    os_id: &str,
    root: &Path,
    cache: &mut ScanCache,
    live_uuids: &[&str],
    now: Instant,
) -> Vec<BrowserProfileInfo> {
    let summary = cache.local_state(root);

    // Opera & co: the root *is* the only profile; no `info_cache`.
    let listed: Vec<LocalStateProfile> = if summary.profiles.is_empty() {
        if root.join("Preferences").is_file() || root.join("Secure Preferences").is_file() {
            vec![LocalStateProfile {
                dir: String::new(),
                name: "Default".to_string(),
                ..Default::default()
            }]
        } else {
            Vec::new()
        }
    } else {
        summary.profiles.clone()
    };

    let only_profile = listed.len() == 1;
    listed
        .into_iter()
        .map(|lp| {
            let folder = if lp.dir.is_empty() {
                root.to_path_buf()
            } else {
                root.join(&lp.dir)
            };
            let marker = cache.marker(&folder);
            let companion = companion_state(marker.as_ref());

            let mut browser_id = None;
            let mut link = None;
            if let Some(bid) = marker
                .as_ref()
                .and_then(|m| m.uninstall_url.as_deref())
                .and_then(bid_from_uninstall_url)
            {
                browser_id = Some(bid);
                link = Some(ProfileLink::Marker);
            }
            // Marker missing, or naming a UUID that isn't connected: look in the
            // extension's storage for one that is.
            let marker_live = browser_id.as_deref().is_some_and(|b| live_uuids.contains(&b));
            if !marker_live && !live_uuids.is_empty() {
                if let Some(m) = &marker {
                    if let Some(u) = cache.storage_uuid(&folder, &m.extension_id, live_uuids, now) {
                        browser_id = Some(u);
                        link = Some(ProfileLink::Storage);
                    }
                }
            }

            let picture = lp
                .picture_file
                .as_deref()
                .map(|f| folder.join(f))
                .filter(|p| p.is_file())
                .or_else(|| {
                    ["Google Profile Picture.png", "Edge Profile Picture.png"]
                        .iter()
                        .map(|f| folder.join(f))
                        .find(|p| p.is_file())
                });
            let avatar_key = picture.and_then(|p| cache.avatar_key(os_id, &lp.dir, &p));

            BrowserProfileInfo {
                last_used: summary.last_used.as_deref() == Some(lp.dir.as_str())
                    || (only_profile && summary.last_used.is_none()),
                open: summary.open.iter().any(|d| d == &lp.dir),
                can_launch: !lp.dir.is_empty(),
                dir: lp.dir,
                name: lp.name,
                email: lp.email,
                account_name: lp.account_name,
                avatar_key,
                color: lp.color,
                companion,
                browser_id,
                link,
            }
        })
        .collect()
}

/// Profiles listed in a Firefox-family `profiles.ini`.
fn scan_firefox_root(base: &Path, cache: &mut ScanCache) -> Vec<BrowserProfileInfo> {
    cache
        .firefox_profiles(base)
        .into_iter()
        .map(|fp| {
            let folder = if fp.is_relative {
                base.join(fp.path.replace('/', std::path::MAIN_SEPARATOR_STR))
            } else {
                PathBuf::from(&fp.path)
            };
            let companion = if cache.firefox_has_companion(&folder) {
                ProfileCompanion::Installed
            } else {
                ProfileCompanion::NotInstalled
            };
            BrowserProfileInfo {
                dir: fp.path,
                name: fp.name,
                email: None,
                account_name: None,
                avatar_key: None,
                color: None,
                last_used: fp.is_default,
                open: false,
                companion,
                browser_id: None,
                link: None,
                can_launch: false,
            }
        })
        .collect()
}

/// All profiles of one browser across its roots. Pure apart from the cache.
fn scan_browser(
    os_id: &str,
    roots: &[ProfileRoot],
    cache: &mut ScanCache,
    live_uuids: &[&str],
    now: Instant,
) -> Vec<BrowserProfileInfo> {
    let mut out = Vec::new();
    for root in roots {
        match root {
            ProfileRoot::Chromium(p) => out.extend(scan_chromium_root(os_id, p, cache, live_uuids, now)),
            ProfileRoot::Firefox(p) => out.extend(scan_firefox_root(p, cache)),
        }
    }
    // One UUID can only live in one profile; a duplicate means a copied
    // profile folder. Keep the first, drop the rest's claim.
    let mut seen: HashSet<String> = HashSet::new();
    for p in &mut out {
        if let Some(id) = &p.browser_id {
            if !seen.insert(id.clone()) {
                p.browser_id = None;
                p.link = None;
            }
        }
    }
    out
}

// ── Roots (Windows) ─────────────────────────────────────────────────────────

#[cfg(windows)]
fn roots_for(os_id: &str) -> Vec<ProfileRoot> {
    let mut roots: Vec<ProfileRoot> = crate::browser_os_scan::chromium_profile_roots(os_id)
        .into_iter()
        .filter(|p| p.is_dir())
        .map(ProfileRoot::Chromium)
        .collect();
    if let Some(base) = crate::browser_os_scan::firefox_profiles_base(os_id) {
        if base.join("profiles.ini").is_file() {
            roots.push(ProfileRoot::Firefox(base));
        }
    }
    roots
}

#[cfg(not(windows))]
fn roots_for(_os_id: &str) -> Vec<ProfileRoot> {
    Vec::new()
}

// ── Process-global snapshot ─────────────────────────────────────────────────

static CACHE: LazyLock<Mutex<ScanCache>> = LazyLock::new(|| Mutex::new(ScanCache::default()));
static SNAPSHOT: LazyLock<RwLock<ProfilesByBrowser>> = LazyLock::new(|| RwLock::new(HashMap::new()));

/// Rescan the profiles of `os_ids`. Cheap when nothing changed (one `stat`
/// per file). `live_uuids` are the connected companion `browserId`s, used to
/// search extension storage when a profile has no marker yet. Returns `true`
/// when the snapshot changed (caller re-emits).
pub fn refresh(os_ids: &[String], live_uuids: &HashSet<String>) -> bool {
    let live: Vec<&str> = live_uuids.iter().map(String::as_str).collect();
    let now = Instant::now();
    let mut fresh: ProfilesByBrowser = HashMap::new();
    {
        let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        for os_id in os_ids {
            let roots = roots_for(os_id);
            if roots.is_empty() {
                continue;
            }
            let profiles = scan_browser(os_id, &roots, &mut cache, &live, now);
            if !profiles.is_empty() {
                fresh.insert(os_id.clone(), profiles);
            }
        }
    }
    let mut snap = SNAPSHOT.write().unwrap_or_else(|e| e.into_inner());
    if *snap == fresh {
        return false;
    }
    *snap = fresh;
    true
}

/// Latest scanned profiles (before merge-time linking).
pub fn snapshot() -> ProfilesByBrowser {
    SNAPSHOT.read().unwrap_or_else(|e| e.into_inner()).clone()
}

/// `data:` URL of the avatar picture behind `key` (from
/// [`BrowserProfileInfo::avatar_key`]), or `None` if unknown/unreadable.
pub fn avatar_data_url(key: &str) -> Option<String> {
    let path = CACHE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .avatars
        .get(key)
        .cloned()?;
    picture_data_url(&path)
}

fn picture_data_url(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() == 0 || meta.len() > AVATAR_FILE_MAX {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if bytes.starts_with(b"RIFF") {
        "image/webp"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else {
        return None;
    };
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

// ── Commands ────────────────────────────────────────────────────────────────

/// Avatar picture for a profile's `avatarKey` (a `data:` URL), or `null`.
/// Pictures are fetched on demand rather than sent with every
/// `browsers://update`, which fires on each tab change.
#[tauri::command]
pub fn get_browser_profile_avatar(key: String) -> Option<String> {
    avatar_data_url(&key)
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    const EXT: &str = crate::extension_setup::config::EXTENSION_ID;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "pilpod-profiles-{tag}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
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

    fn write_local_state(root: &Path, v: Value) {
        fs::create_dir_all(root).unwrap();
        fs::write(root.join("Local State"), v.to_string()).unwrap();
    }

    fn install_companion(profile: &Path, uninstall_url: Option<&str>) {
        fs::create_dir_all(profile).unwrap();
        let mut entry = json!({ "location": 1, "from_webstore": true, "path": format!("{EXT}/2.1.0_0") });
        if let Some(u) = uninstall_url {
            entry["uninstall_url"] = json!(u);
        }
        let doc = json!({ "extensions": { "settings": { EXT: entry } } });
        fs::write(profile.join("Secure Preferences"), doc.to_string()).unwrap();
    }

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    fn chrome_fixture(t: &TempDir) -> PathBuf {
        let root = t.0.join("User Data");
        write_local_state(
            &root,
            json!({
                "profile": {
                    "last_used": "Profile 2",
                    "last_active_profiles": ["Default", "Profile 2"],
                    "info_cache": {
                        "Profile 2": {
                            "name": "Work",
                            "is_using_default_name": false,
                            "user_name": "salah@work.example",
                            "gaia_name": "Salah Work",
                            "gaia_given_name": "Salah",
                            "gaia_picture_file_name": "Google Profile Picture.png",
                            "use_gaia_picture": true,
                            "profile_highlight_color": -16744256
                        },
                        "Default": {
                            "name": "Person 1",
                            "is_using_default_name": true,
                            "user_name": "",
                            "default_avatar_fill_color": -2614432
                        },
                        "Profile 5": { "name": "Kids", "is_using_default_name": false },
                        "Profile 9": { "name": "Hidden", "is_omitted_from_profile_list": true },
                        "Guest Profile": { "name": "Guest" }
                    }
                }
            }),
        );
        root
    }

    #[test]
    fn local_state_lists_profiles_in_chrome_order_with_identity() {
        let s = parse_local_state(&json!({
            "profile": { "info_cache": {
                "Profile 10": { "name": "Ten" },
                "Profile 2": { "name": "Two" },
                "Default": { "name": "Main" },
                "Guest Profile": { "name": "G" },
                "System Profile": { "name": "S" }
            }}
        }));
        let dirs: Vec<&str> = s.profiles.iter().map(|p| p.dir.as_str()).collect();
        assert_eq!(dirs, ["Default", "Profile 2", "Profile 10"]);
    }

    #[test]
    fn default_named_signed_in_profile_shows_account_first_name() {
        let info = json!({ "name": "Person 1", "is_using_default_name": true, "gaia_given_name": "Salah", "gaia_name": "Salah B" });
        assert_eq!(profile_display_name(&info, "Default"), "Salah");
        let custom = json!({ "name": "Work", "is_using_default_name": false, "gaia_given_name": "Salah" });
        assert_eq!(profile_display_name(&custom, "Profile 1"), "Work");
        assert_eq!(profile_display_name(&json!({}), "Profile 7"), "Profile 7");
    }

    #[test]
    fn colors_are_signed_argb() {
        assert_eq!(argb_to_hex(-16744256).as_deref(), Some("#0080c0"));
        assert_eq!(argb_to_hex(0xFF33AA55u32 as i64).as_deref(), Some("#33aa55"));
        assert_eq!(argb_to_hex(i64::MAX), None);
    }

    #[test]
    fn chosen_builtin_avatar_hides_account_picture() {
        let picked = json!({ "gaia_picture_file_name": "Google Profile Picture.png", "use_gaia_picture": false, "is_using_default_avatar": false });
        assert_eq!(picture_file(&picked), None);
        let gaia = json!({ "gaia_picture_file_name": "Google Profile Picture.png", "use_gaia_picture": true });
        assert_eq!(picture_file(&gaia).as_deref(), Some("Google Profile Picture.png"));
    }

    #[test]
    fn uninstall_url_marker_parsing() {
        assert_eq!(
            bid_from_uninstall_url("http://127.0.0.1:17399/companion-removed?bid=3f9a2c1b-1111-4222-8333-444455556666").as_deref(),
            Some("3f9a2c1b-1111-4222-8333-444455556666")
        );
        assert_eq!(
            bid_from_uninstall_url("http://127.0.0.1:17399/companion-removed?x=1&bid=b-171-abc#frag").as_deref(),
            Some("b-171-abc")
        );
        // Someone else's URL, or junk, is ignored.
        assert_eq!(bid_from_uninstall_url("https://example.com/bye?bid=3f9a2c1b-1111"), None);
        assert_eq!(bid_from_uninstall_url("http://127.0.0.1:17399/companion-removed?bid=<script>"), None);
        assert_eq!(bid_from_uninstall_url("http://127.0.0.1:17399/companion-removed"), None);
    }

    #[test]
    fn chromium_scan_reads_identity_marker_avatar_and_open_state() {
        let t = TempDir::new("chromium");
        let root = chrome_fixture(&t);
        install_companion(
            &root.join("Profile 2"),
            Some("http://127.0.0.1:17399/companion-removed?bid=uuid-work-0001"),
        );
        fs::write(root.join("Profile 2").join("Google Profile Picture.png"), PNG).unwrap();
        fs::create_dir_all(root.join("Default")).unwrap();

        let mut cache = ScanCache::default();
        let got = scan_browser("chrome", &[ProfileRoot::Chromium(root.clone())], &mut cache, &[], Instant::now());

        let names: Vec<&str> = got.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Person 1", "Work", "Kids"]);

        let work = &got[1];
        assert_eq!(work.dir, "Profile 2");
        assert_eq!(work.email.as_deref(), Some("salah@work.example"));
        assert_eq!(work.account_name.as_deref(), Some("Salah Work"));
        assert_eq!(work.color.as_deref(), Some("#0080c0"));
        assert!(work.last_used && work.open && work.can_launch);
        assert_eq!(work.companion, ProfileCompanion::Installed);
        assert_eq!(work.browser_id.as_deref(), Some("uuid-work-0001"));
        assert_eq!(work.link, Some(ProfileLink::Marker));
        let key = work.avatar_key.clone().expect("avatar");
        assert!(picture_data_url(&cache.avatars[&key]).unwrap().starts_with("data:image/png;base64,"));

        let default = &got[0];
        assert_eq!(default.email, None);
        assert_eq!(default.color.as_deref(), Some("#d81b60"));
        assert!(default.open && !default.last_used);
        assert_eq!(default.companion, ProfileCompanion::NotInstalled);
        assert_eq!(default.avatar_key, None);

        assert!(!got[2].open);
    }

    #[test]
    fn storage_search_links_profiles_without_marker() {
        let t = TempDir::new("storage");
        let root = chrome_fixture(&t);
        let kids = root.join("Profile 5");
        install_companion(&kids, None);
        let store = kids.join("Local Extension Settings").join(EXT);
        fs::create_dir_all(&store).unwrap();
        let mut blob = b"\x00\x01bridge.browserId\x00\"".to_vec();
        blob.extend_from_slice(b"uuid-kids-0002\"\x00");
        fs::write(store.join("000003.log"), &blob).unwrap();

        let mut cache = ScanCache::default();
        let roots = [ProfileRoot::Chromium(root)];
        let got = scan_browser("chrome", &roots, &mut cache, &["uuid-other", "uuid-kids-0002"], Instant::now());
        let kids = got.iter().find(|p| p.dir == "Profile 5").unwrap();
        assert_eq!(kids.browser_id.as_deref(), Some("uuid-kids-0002"));
        assert_eq!(kids.link, Some(ProfileLink::Storage));

        // Not live any more → not claimed.
        let mut cache = ScanCache::default();
        let got = scan_browser("chrome", &roots, &mut cache, &["uuid-other"], Instant::now());
        assert_eq!(got.iter().find(|p| p.dir == "Profile 5").unwrap().browser_id, None);
    }

    #[test]
    fn storage_misses_are_not_rescanned_immediately() {
        let t = TempDir::new("miss");
        let profile = t.0.join("Default");
        let store = profile.join("Local Extension Settings").join(EXT);
        fs::create_dir_all(&store).unwrap();
        let mut cache = ScanCache::default();
        let now = Instant::now();
        assert_eq!(cache.storage_uuid(&profile, EXT, &["uuid-late"], now), None);
        fs::write(store.join("000001.log"), b"uuid-late").unwrap();
        assert_eq!(cache.storage_uuid(&profile, EXT, &["uuid-late"], now + Duration::from_secs(1)), None);
        assert_eq!(
            cache.storage_uuid(&profile, EXT, &["uuid-late"], now + STORAGE_MISS_RETRY).as_deref(),
            Some("uuid-late")
        );
    }

    #[test]
    fn cache_picks_up_renamed_profile() {
        let t = TempDir::new("rename");
        let root = t.0.join("User Data");
        write_local_state(&root, json!({ "profile": { "info_cache": { "Default": { "name": "Old" } } } }));
        let mut cache = ScanCache::default();
        let roots = [ProfileRoot::Chromium(root.clone())];
        assert_eq!(scan_browser("c", &roots, &mut cache, &[], Instant::now())[0].name, "Old");
        // Different length ⇒ different stamp even within mtime resolution.
        write_local_state(&root, json!({ "profile": { "info_cache": { "Default": { "name": "Renamed" } } } }));
        assert_eq!(scan_browser("c", &roots, &mut cache, &[], Instant::now())[0].name, "Renamed");
    }

    #[test]
    fn opera_style_root_is_single_profile() {
        let t = TempDir::new("opera");
        let root = t.0.join("Opera Stable");
        install_companion(&root, Some("http://127.0.0.1:17399/companion-removed?bid=uuid-opera-1"));
        let got = scan_browser("opera", &[ProfileRoot::Chromium(root)], &mut ScanCache::default(), &[], Instant::now());
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].dir, "");
        assert!(!got[0].can_launch);
        assert!(got[0].last_used);
        assert_eq!(got[0].browser_id.as_deref(), Some("uuid-opera-1"));
    }

    #[test]
    fn duplicate_uuid_claims_keep_first_profile_only() {
        let t = TempDir::new("dup");
        let root = chrome_fixture(&t);
        let url = "http://127.0.0.1:17399/companion-removed?bid=uuid-same";
        install_companion(&root.join("Default"), Some(url));
        install_companion(&root.join("Profile 2"), Some(url));
        let got = scan_browser("chrome", &[ProfileRoot::Chromium(root)], &mut ScanCache::default(), &[], Instant::now());
        let claims: Vec<&str> = got.iter().filter_map(|p| p.browser_id.as_deref()).collect();
        assert_eq!(claims, ["uuid-same"]);
        assert_eq!(got[0].browser_id.as_deref(), Some("uuid-same"));
    }

    #[test]
    fn firefox_profiles_ini_with_install_default() {
        let ini = "[Install308046B0AF4A39CB]\nDefault=Profiles/abcd.default-release\nLocked=1\n\n\
                   [Profile1]\nName=default\nIsRelative=1\nPath=Profiles/wxyz.default\nDefault=1\n\n\
                   [Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abcd.default-release\n\n\
                   [General]\nStartWithLastProfile=1\nVersion=2\n";
        let got = parse_profiles_ini(ini);
        assert_eq!(got.len(), 2);
        let release = got.iter().find(|p| p.name == "default-release").unwrap();
        assert!(release.is_default && release.is_relative);
        assert!(!got.iter().find(|p| p.name == "default").unwrap().is_default);
    }

    #[test]
    fn firefox_scan_detects_companion_by_name() {
        let t = TempDir::new("ff");
        fs::write(t.0.join("profiles.ini"), "[Profile0]\nName=Main\nIsRelative=1\nPath=Profiles/a.main\nDefault=1\n").unwrap();
        let p = t.0.join("Profiles").join("a.main");
        fs::create_dir_all(&p).unwrap();
        fs::write(p.join("extensions.json"), r#"{"addons":[{"defaultLocale":{"name":"PilPod Companion"}}]}"#).unwrap();
        let got = scan_browser("firefox", &[ProfileRoot::Firefox(t.0.clone())], &mut ScanCache::default(), &[], Instant::now());
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "Main");
        assert_eq!(got[0].companion, ProfileCompanion::Installed);
        assert!(got[0].last_used && !got[0].can_launch);
    }

    fn profile(dir: &str, companion: ProfileCompanion, bid: Option<&str>) -> BrowserProfileInfo {
        BrowserProfileInfo {
            dir: dir.into(),
            name: dir.into(),
            email: None,
            account_name: None,
            avatar_key: None,
            color: None,
            last_used: false,
            open: false,
            companion,
            browser_id: bid.map(str::to_string),
            link: bid.map(|_| ProfileLink::Marker),
            can_launch: true,
        }
    }

    #[test]
    fn link_uses_markers_then_infers_single_leftover() {
        use ProfileCompanion::*;
        let mut ps = vec![
            profile("Default", Installed, Some("a")),
            profile("Profile 2", Installed, None),
            profile("Profile 3", NotInstalled, None),
        ];
        let m = link_slots(&mut ps, &["a", "b"]);
        assert_eq!(m["a"], 0);
        assert_eq!(m["b"], 1);
        assert_eq!(ps[1].link, Some(ProfileLink::Inferred));
        assert_eq!(ps[1].browser_id.as_deref(), Some("b"));
    }

    #[test]
    fn link_does_not_guess_between_two_candidates() {
        use ProfileCompanion::*;
        let mut ps = vec![profile("Default", Installed, None), profile("Profile 2", Installed, None)];
        assert!(link_slots(&mut ps, &["x"]).is_empty());
        let mut ps = vec![profile("Default", Installed, None), profile("Profile 2", Installed, None)];
        assert!(link_slots(&mut ps, &["x", "y"]).is_empty());
    }

    #[test]
    fn link_replaces_stale_marker_and_handles_single_profile_browser() {
        use ProfileCompanion::*;
        // Storage cleared → new UUID; the old marker isn't live.
        let mut ps = vec![profile("Default", Installed, Some("old")), profile("Profile 2", NotInstalled, None)];
        let m = link_slots(&mut ps, &["new"]);
        assert_eq!(m["new"], 0);
        assert_eq!(ps[0].browser_id.as_deref(), Some("new"));

        // One profile, companion entry unreadable: still the only option.
        let mut ps = vec![profile("", NotInstalled, None)];
        assert_eq!(link_slots(&mut ps, &["z"])["z"], 0);
    }

    #[test]
    fn serializes_camel_case() {
        let p = profile("Profile 2", ProfileCompanion::Installed, Some("u"));
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["companion"], "installed");
        assert_eq!(v["browserId"], "u");
        assert_eq!(v["link"], "marker");
        assert_eq!(v["canLaunch"], true);
        assert!(v.get("email").is_none());
    }
}
