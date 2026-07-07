//! Bundled browser icons — loaded from app resources, keyed by catalog id.
//!
//! Phase 1 of the browser-identity overhaul (see `plans/BROWSER_IDENTITY_OVERHAUL.md`).
//! Icons are PNG files shipped in `icons/browsers/{id}.png` (see `MANIFEST.md` there).
//! No OS icon extraction: the fallback chain is `{id}.png` → `_generic.png` → `None`,
//! so the UI is deterministic across machines and install states.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use base64::{engine::general_purpose::STANDARD, Engine as _};

/// Filename of the fallback icon used when a browser has no dedicated PNG.
const GENERIC_ICON: &str = "_generic.png";

/// Directory (resolved once at startup) containing the bundled icon PNGs.
static ICONS_DIR: LazyLock<Mutex<Option<PathBuf>>> = LazyLock::new(|| Mutex::new(None));

/// Data-URL cache, keyed by catalog id. `None` is cached too (missing icon + missing generic).
static CACHE: LazyLock<Mutex<HashMap<String, Option<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Resolve and remember the bundled-icons directory.
///
/// Picks the candidate directory containing the MOST `.png` files (first wins
/// ties). This guards against a stale resource copy in `target/` shadowing the
/// freshly-populated source folder during dev: whichever copy actually has the
/// icons wins.
pub fn init(candidates: &[PathBuf]) {
    let found = pick_icons_dir(candidates);
    match &found {
        Some(dir) => eprintln!(
            "[browser-icon] using {:?} ({} png files)",
            dir,
            count_pngs(dir)
        ),
        None => eprintln!(
            "[browser-icon] no icons directory with PNGs found (tried {:?}) — icons disabled",
            candidates
        ),
    }
    if let Ok(mut dir) = ICONS_DIR.lock() {
        *dir = found;
    }
    clear_cache();
}

/// Number of `.png` entries directly inside `dir`.
fn count_pngs(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    e.path()
                        .extension()
                        .map(|ext| ext.eq_ignore_ascii_case("png"))
                        .unwrap_or(false)
                })
                .count()
        })
        .unwrap_or(0)
}

/// The existing candidate with the most PNGs; earlier candidates win ties.
/// Falls back to the first existing directory when none contain PNGs.
fn pick_icons_dir(candidates: &[PathBuf]) -> Option<PathBuf> {
    let mut best: Option<(&PathBuf, usize)> = None;
    for p in candidates.iter().filter(|p| p.is_dir()) {
        let n = count_pngs(p);
        if n > 0 && best.map(|(_, bn)| n > bn).unwrap_or(true) {
            best = Some((p, n));
        }
    }
    best.map(|(p, _)| p.clone())
        .or_else(|| candidates.iter().find(|p| p.is_dir()).cloned())
}

/// PNG data URL for a catalog browser id, cached for the process lifetime.
pub fn data_url_for_browser(os_browser_id: &str) -> Option<String> {
    let mut cache = CACHE.lock().ok()?;
    if let Some(cached) = cache.get(os_browser_id) {
        return cached.clone();
    }

    let dir = ICONS_DIR.lock().ok()?.clone()?;
    let url = resolve_icon_path(&dir, os_browser_id).and_then(|p| load_data_url(&p));
    cache.insert(os_browser_id.to_string(), url.clone());
    url
}

/// Drop all cached data URLs (dev-lab action; also called by `init`).
pub fn clear_cache() {
    if let Ok(mut cache) = CACHE.lock() {
        cache.clear();
    }
}

// ── Pure logic (unit tested) ─────────────────────────────────────────────────

/// `{dir}/{id}.png` if present, else `{dir}/_generic.png` if present, else `None`.
///
/// The id is sanitised to `[a-z0-9_-]` to keep lookups strictly inside `dir`.
fn resolve_icon_path(dir: &Path, os_browser_id: &str) -> Option<PathBuf> {
    let safe: String = os_browser_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>()
        .to_ascii_lowercase();

    if !safe.is_empty() {
        let specific = dir.join(format!("{safe}.png"));
        if specific.is_file() {
            return Some(specific);
        }
    }

    let generic = dir.join(GENERIC_ICON);
    generic.is_file().then_some(generic)
}

/// Read a PNG file and encode it as a `data:image/png;base64,...` URL.
fn load_data_url(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique temp dir per test; cleaned up on drop.
    struct TempIcons(PathBuf);

    impl TempIcons {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("pilpod_icon_test_{tag}_{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn put(&self, name: &str, bytes: &[u8]) {
            std::fs::write(self.0.join(name), bytes).unwrap();
        }
    }

    impl Drop for TempIcons {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const PNG_STUB: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3];

    #[test]
    fn resolves_specific_icon() {
        let t = TempIcons::new("specific");
        t.put("chrome.png", PNG_STUB);
        t.put(GENERIC_ICON, PNG_STUB);
        assert_eq!(
            resolve_icon_path(&t.0, "chrome").unwrap(),
            t.0.join("chrome.png")
        );
    }

    #[test]
    fn falls_back_to_generic() {
        let t = TempIcons::new("generic");
        t.put(GENERIC_ICON, PNG_STUB);
        assert_eq!(
            resolve_icon_path(&t.0, "librewolf").unwrap(),
            t.0.join(GENERIC_ICON)
        );
    }

    #[test]
    fn returns_none_when_nothing_present() {
        let t = TempIcons::new("empty");
        assert!(resolve_icon_path(&t.0, "chrome").is_none());
    }

    #[test]
    fn sanitises_hostile_ids() {
        let t = TempIcons::new("hostile");
        t.put(GENERIC_ICON, PNG_STUB);
        // Path traversal collapses to generic, never escapes the dir.
        let p = resolve_icon_path(&t.0, "../../etc/passwd").unwrap();
        assert!(p.starts_with(&t.0));
    }

    #[test]
    fn data_url_round_trip() {
        let t = TempIcons::new("dataurl");
        t.put("brave.png", PNG_STUB);
        let url = load_data_url(&t.0.join("brave.png")).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        let b64 = url.strip_prefix("data:image/png;base64,").unwrap();
        assert_eq!(STANDARD.decode(b64).unwrap(), PNG_STUB);
    }

    #[test]
    fn empty_file_yields_none() {
        let t = TempIcons::new("emptyfile");
        t.put("vivaldi.png", &[]);
        assert!(load_data_url(&t.0.join("vivaldi.png")).is_none());
    }

    #[test]
    fn picks_candidate_with_most_pngs_not_first_existing() {
        // Regression: a stale resource copy (generic only) must not shadow the
        // freshly-populated source folder.
        let stale = TempIcons::new("pick_stale");
        stale.put(GENERIC_ICON, PNG_STUB);
        let fresh = TempIcons::new("pick_fresh");
        fresh.put(GENERIC_ICON, PNG_STUB);
        fresh.put("chrome.png", PNG_STUB);
        fresh.put("brave.png", PNG_STUB);

        let picked = pick_icons_dir(&[stale.0.clone(), fresh.0.clone()]).unwrap();
        assert_eq!(picked, fresh.0);
    }

    #[test]
    fn earlier_candidate_wins_ties() {
        let a = TempIcons::new("tie_a");
        a.put(GENERIC_ICON, PNG_STUB);
        let b = TempIcons::new("tie_b");
        b.put(GENERIC_ICON, PNG_STUB);
        let picked = pick_icons_dir(&[a.0.clone(), b.0.clone()]).unwrap();
        assert_eq!(picked, a.0);
    }

    #[test]
    fn falls_back_to_first_existing_dir_without_pngs() {
        let empty = TempIcons::new("pick_empty");
        let picked = pick_icons_dir(&[
            PathBuf::from("/definitely/not/here"),
            empty.0.clone(),
        ])
        .unwrap();
        assert_eq!(picked, empty.0);
    }

    #[test]
    fn no_existing_candidate_yields_none() {
        assert!(pick_icons_dir(&[PathBuf::from("/nope/a"), PathBuf::from("/nope/b")]).is_none());
    }

    #[test]
    fn every_catalog_id_resolves_with_full_icon_set() {
        let t = TempIcons::new("catalog");
        t.put(GENERIC_ICON, PNG_STUB);
        for entry in crate::browser_catalog::CATALOG {
            t.put(&format!("{}.png", entry.id), PNG_STUB);
            let p = resolve_icon_path(&t.0, entry.id).unwrap();
            assert_eq!(p, t.0.join(format!("{}.png", entry.id)), "id {}", entry.id);
        }
    }
}
