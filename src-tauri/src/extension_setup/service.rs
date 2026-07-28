//! Setup logic — everything the commands do, minus Tauri.
//!
//! `commands.rs` is a thin translation layer (managed state → these functions →
//! `Result<_, String>`); all decisions live here so they can be tested with
//! [`MockOps`](super::launcher::MockOps) and a plain [`ActivationStore`].

use serde::Serialize;

use super::activation::{ActivationEvent, ActivationState};
use super::config;
use super::engine::{self, EngineFamily, StoreSupport};
use super::launcher::BrowserOps;
use super::store::ActivationStore;

// ── Errors ──────────────────────────────────────────────────────────────────

/// Why a setup action could not be performed. Typed so the frontend can react
/// differently per case instead of pattern-matching on English.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "browserId", rename_all = "camelCase")]
pub enum SetupError {
    /// Not a browser we know about at all.
    UnknownBrowser(String),
    /// Known browser, but we cannot find its executable on this machine.
    NotInstalled(String),
    /// Known and installed, but it cannot install a Chrome Web Store item.
    Unsupported(String),
    /// We have no reliable internal deep link for this browser.
    NoExtensionsPage(String),
    /// The process failed to spawn.
    LaunchFailed(String),
}

impl std::fmt::Display for SetupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownBrowser(id) => write!(f, "unknown browser: {id}"),
            Self::NotInstalled(id) => write!(f, "{id} is not installed on this machine"),
            Self::Unsupported(id) => {
                write!(f, "{id} cannot install extensions from the Chrome Web Store")
            }
            Self::NoExtensionsPage(id) => write!(f, "no extensions page known for {id}"),
            Self::LaunchFailed(msg) => write!(f, "{msg}"),
        }
    }
}

impl From<SetupError> for String {
    fn from(e: SetupError) -> String {
        e.to_string()
    }
}

// ── DTOs ────────────────────────────────────────────────────────────────────

/// What `commands.rs` knows about a browser before activation is layered on.
/// Assembled from the detector, the icon cache and the on-disk profile scan.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BrowserFacts {
    pub id: String,
    pub display_name: String,
    pub running: bool,
    pub icon_url: Option<String>,
    /// The companion's files were found in one of this browser's profiles.
    /// Distinguishes "never installed" from "installed but not talking to us"
    /// (disabled, or the bridge port is blocked) — different advice each way.
    pub extension_on_disk: bool,
}

/// One row in the setup UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSetupInfo {
    pub id: String,
    pub display_name: String,
    pub engine: EngineFamily,
    pub store_support: StoreSupport,
    pub extensions_page: Option<&'static str>,
    pub activation_state: ActivationState,
    /// Executable resolvable ⇒ we can actually launch it for the user.
    pub launchable: bool,
    pub running: bool,
    pub extension_on_disk: bool,
    pub icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_activated_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_verified_at: Option<u64>,
}

/// Everything the setup screen needs in one round trip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupOverview {
    /// Canonical listing URL — shown with a copy button for manual install.
    pub store_url: String,
    pub browsers: Vec<BrowserSetupInfo>,
    pub onboarding_dismissed: bool,
    /// Any supported browser is `Inactive` or `Revoked`. Drives the first-run
    /// gate and the "needs setup" badge on the menu entry.
    pub needs_attention: bool,
    /// At least one browser is verified — the app is usable as intended.
    pub any_active: bool,
}

// ── Overview ────────────────────────────────────────────────────────────────

/// Join detected browsers with their engine capabilities and activation state.
///
/// Ordering is deliberate and stable: browsers needing action first (so the
/// thing to do is at the top), then active ones, then unsupported; alphabetical
/// within each band. A `HashMap`-ordered list would reshuffle on every poll.
pub fn build_overview(
    facts: &[BrowserFacts],
    store: &ActivationStore,
    ops: &dyn BrowserOps,
) -> SetupOverview {
    let mut browsers: Vec<BrowserSetupInfo> = facts
        .iter()
        .map(|f| {
            let info = engine::engine_or_unknown(&f.id);
            let record = store.record_of(&f.id);
            BrowserSetupInfo {
                id: f.id.clone(),
                display_name: f.display_name.clone(),
                engine: info.engine,
                store_support: info.store_support,
                extensions_page: info.extensions_page,
                activation_state: record.map(|r| r.state).unwrap_or_default(),
                launchable: ops.resolve_exe(&f.id).is_some(),
                running: f.running,
                extension_on_disk: f.extension_on_disk,
                icon_url: f.icon_url.clone(),
                first_activated_at: record.and_then(|r| r.first_activated_at),
                last_verified_at: record.and_then(|r| r.last_verified_at),
            }
        })
        .collect();

    browsers.sort_by(|a, b| sort_band(a).cmp(&sort_band(b)).then(a.id.cmp(&b.id)));

    let needs_attention = browsers
        .iter()
        .any(|b| b.store_support != StoreSupport::Unsupported && b.activation_state.needs_attention());
    let any_active = browsers.iter().any(|b| b.activation_state.is_active());

    SetupOverview {
        store_url: config::store_listing_url(),
        browsers,
        onboarding_dismissed: store.onboarding_dismissed(),
        needs_attention,
        any_active,
    }
}

/// 0 = act on me, 1 = in progress, 2 = done, 3 = skipped, 4 = can't help you.
fn sort_band(b: &BrowserSetupInfo) -> u8 {
    if b.store_support == StoreSupport::Unsupported {
        return 4;
    }
    match b.activation_state {
        ActivationState::Inactive | ActivationState::Revoked => 0,
        ActivationState::SetupPending => 1,
        ActivationState::Active => 2,
        ActivationState::Skipped => 3,
    }
}

// ── Actions ─────────────────────────────────────────────────────────────────

/// Launch `os_browser_id` at the Chrome Web Store listing and mark setup started.
///
/// Returns the URL that was opened so the UI can show it (and so tests can
/// assert on it without reaching into the mock).
pub fn open_store_listing(
    ops: &dyn BrowserOps,
    store: &mut ActivationStore,
    os_browser_id: &str,
    now_ms: u64,
) -> Result<String, SetupError> {
    let info = engine::engine_for(os_browser_id)
        .ok_or_else(|| SetupError::UnknownBrowser(os_browser_id.to_string()))?;

    if !info.can_install() {
        return Err(SetupError::Unsupported(os_browser_id.to_string()));
    }

    let exe = ops
        .resolve_exe(os_browser_id)
        .ok_or_else(|| SetupError::NotInstalled(os_browser_id.to_string()))?;

    let url = config::store_listing_url();
    ops.open_url(&exe, &url).map_err(SetupError::LaunchFailed)?;

    // Only after a successful launch — a failed spawn must not leave the browser
    // stuck in `SetupPending` with nothing on screen.
    store.apply(os_browser_id, ActivationEvent::SetupStarted, now_ms);
    Ok(url)
}

/// Open the browser's own extensions page, deep-linked to our item.
/// Troubleshooting only: never changes activation state.
pub fn open_extensions_page(
    ops: &dyn BrowserOps,
    os_browser_id: &str,
) -> Result<String, SetupError> {
    let info = engine::engine_for(os_browser_id)
        .ok_or_else(|| SetupError::UnknownBrowser(os_browser_id.to_string()))?;

    let page = info
        .extensions_page
        .ok_or_else(|| SetupError::NoExtensionsPage(os_browser_id.to_string()))?;

    let exe = ops
        .resolve_exe(os_browser_id)
        .ok_or_else(|| SetupError::NotInstalled(os_browser_id.to_string()))?;

    let url = config::extension_detail_url(page);
    ops.open_url(&exe, &url).map_err(SetupError::LaunchFailed)?;
    Ok(url)
}

/// "Skip for now" — locked, but never nagged about again.
pub fn skip_browser(store: &mut ActivationStore, os_browser_id: &str, now_ms: u64) -> bool {
    store.apply(os_browser_id, ActivationEvent::SkipRequested, now_ms)
}

/// Back out of the guide without installing.
pub fn cancel_setup(store: &mut ActivationStore, os_browser_id: &str, now_ms: u64) -> bool {
    store.apply(os_browser_id, ActivationEvent::SetupCancelled, now_ms)
}

/// Dev-lab / "start over" for one browser.
pub fn reset_browser(store: &mut ActivationStore, os_browser_id: &str, now_ms: u64) -> bool {
    store.apply(os_browser_id, ActivationEvent::Reset, now_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extension_setup::launcher::MockOps;
    use crate::extension_setup::store::ActivationData;
    use std::path::PathBuf;

    const STORE_URL: &str = "https://chromewebstore.google.com/detail/ooogjmdnagfepkocppnldkafbcbmdhal";

    fn store() -> ActivationStore {
        ActivationStore::new(ActivationData::default(), PathBuf::new())
    }

    fn facts(id: &str, name: &str) -> BrowserFacts {
        BrowserFacts {
            id: id.to_string(),
            display_name: name.to_string(),
            running: false,
            icon_url: None,
            extension_on_disk: false,
        }
    }

    // ── open_store_listing ──────────────────────────────────────────────────

    #[test]
    fn opens_the_listing_in_the_requested_browser() {
        let ops = MockOps::with_installed(&["chrome", "msedge"]);
        let mut st = store();

        let url = open_store_listing(&ops, &mut st, "msedge", 100).unwrap();

        assert_eq!(url, STORE_URL);
        let (exe, opened) = ops.only_call();
        assert_eq!(
            exe,
            PathBuf::from("C:\\fake\\msedge.exe"),
            "must launch Edge itself, not the default browser"
        );
        assert_eq!(opened, STORE_URL);
        assert_eq!(st.state_of("msedge"), ActivationState::SetupPending);
        assert_eq!(
            st.state_of("chrome"),
            ActivationState::Inactive,
            "other browsers untouched"
        );
    }

    #[test]
    fn unknown_browser_errors_and_launches_nothing() {
        let ops = MockOps::with_installed(&["chrome"]);
        let mut st = store();

        let err = open_store_listing(&ops, &mut st, "netscape", 1).unwrap_err();

        assert_eq!(err, SetupError::UnknownBrowser("netscape".into()));
        assert!(ops.calls().is_empty());
        assert_eq!(st.state_of("netscape"), ActivationState::Inactive);
    }

    #[test]
    fn gecko_browser_is_rejected_before_launching() {
        let ops = MockOps::with_installed(&["firefox"]);
        let mut st = store();

        let err = open_store_listing(&ops, &mut st, "firefox", 1).unwrap_err();

        assert_eq!(err, SetupError::Unsupported("firefox".into()));
        assert!(
            ops.calls().is_empty(),
            "never send a Firefox user to a page whose install button cannot work"
        );
        assert_eq!(st.state_of("firefox"), ActivationState::Inactive);
    }

    #[test]
    fn missing_executable_errors_without_state_change() {
        let ops = MockOps::with_installed(&["chrome"]);
        let mut st = store();

        let err = open_store_listing(&ops, &mut st, "brave", 1).unwrap_err();

        assert_eq!(err, SetupError::NotInstalled("brave".into()));
        assert_eq!(st.state_of("brave"), ActivationState::Inactive);
    }

    #[test]
    fn failed_launch_does_not_mark_setup_pending() {
        let ops = MockOps::failing(&["chrome"]);
        let mut st = store();

        let err = open_store_listing(&ops, &mut st, "chrome", 1).unwrap_err();

        assert!(matches!(err, SetupError::LaunchFailed(_)));
        assert_eq!(
            st.state_of("chrome"),
            ActivationState::Inactive,
            "a browser that never opened must not look like setup is underway"
        );
    }

    #[test]
    fn reopening_the_listing_for_an_active_browser_does_not_demote_it() {
        let ops = MockOps::with_installed(&["chrome"]);
        let mut st = store();
        st.apply("chrome", ActivationEvent::HandshakeVerified, 1);

        open_store_listing(&ops, &mut st, "chrome", 2).unwrap();

        assert_eq!(st.state_of("chrome"), ActivationState::Active);
    }

    // ── open_extensions_page ────────────────────────────────────────────────

    #[test]
    fn extensions_page_is_deep_linked_to_our_item() {
        let ops = MockOps::with_installed(&["msedge"]);
        let url = open_extensions_page(&ops, "msedge").unwrap();
        assert_eq!(
            url,
            "edge://extensions/?id=ooogjmdnagfepkocppnldkafbcbmdhal"
        );
        assert_eq!(ops.only_call().0, PathBuf::from("C:\\fake\\msedge.exe"));
    }

    #[test]
    fn extensions_page_never_changes_activation_state() {
        // Enforced structurally: `open_extensions_page` takes no store at all,
        // so troubleshooting a working browser cannot lock its dashboard row.
        let ops = MockOps::with_installed(&["chrome"]);
        let st = store();
        open_extensions_page(&ops, "chrome").unwrap();
        assert_eq!(st.state_of("chrome"), ActivationState::Inactive);
    }

    #[test]
    fn gecko_has_no_extensions_deep_link() {
        let ops = MockOps::with_installed(&["firefox"]);
        assert_eq!(
            open_extensions_page(&ops, "firefox").unwrap_err(),
            SetupError::NoExtensionsPage("firefox".into())
        );
    }

    // ── build_overview ──────────────────────────────────────────────────────

    #[test]
    fn overview_joins_engine_and_activation_data() {
        let ops = MockOps::with_installed(&["chrome"]);
        let mut st = store();
        st.apply("chrome", ActivationEvent::HandshakeVerified, 555);

        let ov = build_overview(&[facts("chrome", "Google Chrome")], &st, &ops);

        assert_eq!(ov.store_url, STORE_URL);
        assert_eq!(ov.browsers.len(), 1);
        let b = &ov.browsers[0];
        assert_eq!(b.display_name, "Google Chrome");
        assert_eq!(b.engine, EngineFamily::Chromium);
        assert_eq!(b.store_support, StoreSupport::Native);
        assert_eq!(b.activation_state, ActivationState::Active);
        assert_eq!(b.extensions_page, Some("chrome://extensions"));
        assert!(b.launchable);
        assert_eq!(b.first_activated_at, Some(555));
        assert!(ov.any_active);
        assert!(!ov.needs_attention);
    }

    #[test]
    fn launchable_is_false_when_the_exe_cannot_be_found() {
        // Detected via registry but the exe is gone (uninstalled mid-session).
        let ops = MockOps::with_installed(&[]);
        let st = store();
        let ov = build_overview(&[facts("chrome", "Google Chrome")], &st, &ops);
        assert!(!ov.browsers[0].launchable);
    }

    #[test]
    fn needs_attention_ignores_unsupported_and_skipped_browsers() {
        let ops = MockOps::with_installed(&["firefox", "chrome"]);
        let mut st = store();

        // Firefox alone: unsupported, so there is nothing to nag about.
        let ov = build_overview(&[facts("firefox", "Firefox")], &st, &ops);
        assert!(!ov.needs_attention);
        assert!(!ov.any_active);

        // Chrome inactive: that *is* actionable.
        let both = [facts("firefox", "Firefox"), facts("chrome", "Chrome")];
        assert!(build_overview(&both, &st, &ops).needs_attention);

        // Once skipped, stop asking.
        st.apply("chrome", ActivationEvent::SkipRequested, 1);
        assert!(!build_overview(&both, &st, &ops).needs_attention);
    }

    #[test]
    fn overview_order_puts_actionable_browsers_first() {
        let ops = MockOps::with_installed(&["chrome", "msedge", "brave", "vivaldi", "firefox"]);
        let mut st = store();
        st.apply("brave", ActivationEvent::HandshakeVerified, 1); // Active  → band 2
        st.apply("chrome", ActivationEvent::SetupStarted, 1); //     Pending → band 1
        st.apply("vivaldi", ActivationEvent::SkipRequested, 1); //   Skipped → band 3
                                                                //  msedge   Inactive→ band 0
                                                                //  firefox  Unsupported→ band 4
        let ov = build_overview(
            &[
                facts("vivaldi", "Vivaldi"),
                facts("firefox", "Firefox"),
                facts("brave", "Brave"),
                facts("chrome", "Chrome"),
                facts("msedge", "Edge"),
            ],
            &st,
            &ops,
        );

        let ids: Vec<&str> = ov.browsers.iter().map(|b| b.id.as_str()).collect();
        assert_eq!(ids, ["msedge", "chrome", "brave", "vivaldi", "firefox"]);
    }

    #[test]
    fn overview_order_is_stable_for_equal_bands() {
        let ops = MockOps::with_installed(&["chrome", "brave", "msedge"]);
        let st = store();
        let input = [
            facts("msedge", "Edge"),
            facts("chrome", "Chrome"),
            facts("brave", "Brave"),
        ];
        let first = build_overview(&input, &st, &ops);
        let second = build_overview(&input, &st, &ops);
        assert_eq!(first.browsers, second.browsers);
        // All Inactive ⇒ alphabetical by id.
        let ids: Vec<&str> = first.browsers.iter().map(|b| b.id.as_str()).collect();
        assert_eq!(ids, ["brave", "chrome", "msedge"]);
    }

    #[test]
    fn on_disk_flag_survives_into_the_dto() {
        let ops = MockOps::with_installed(&["chrome"]);
        let st = store();
        let mut f = facts("chrome", "Chrome");
        f.extension_on_disk = true;
        let ov = build_overview(&[f], &st, &ops);
        assert!(
            ov.browsers[0].extension_on_disk,
            "the UI needs this to say 'installed but not connected'"
        );
    }

    #[test]
    fn empty_machine_produces_an_empty_but_valid_overview() {
        let ops = MockOps::with_installed(&[]);
        let st = store();
        let ov = build_overview(&[], &st, &ops);
        assert!(ov.browsers.is_empty());
        assert!(!ov.needs_attention);
        assert!(!ov.any_active);
        assert_eq!(ov.store_url, STORE_URL);
    }

    // ── state-only actions ──────────────────────────────────────────────────

    #[test]
    fn skip_cancel_and_reset_move_state_as_documented() {
        let mut st = store();
        assert!(skip_browser(&mut st, "chrome", 1));
        assert_eq!(st.state_of("chrome"), ActivationState::Skipped);

        assert!(reset_browser(&mut st, "chrome", 2));
        assert_eq!(st.state_of("chrome"), ActivationState::Inactive);

        st.apply("chrome", ActivationEvent::SetupStarted, 3);
        assert!(cancel_setup(&mut st, "chrome", 4));
        assert_eq!(st.state_of("chrome"), ActivationState::Inactive);
    }

    // ── wire format ─────────────────────────────────────────────────────────

    #[test]
    fn overview_serializes_camel_case_for_the_frontend() {
        let ops = MockOps::with_installed(&["chrome"]);
        let st = store();
        let json = serde_json::to_string(&build_overview(
            &[facts("chrome", "Google Chrome")],
            &st,
            &ops,
        ))
        .unwrap();

        for key in [
            "\"storeUrl\"",
            "\"activationState\"",
            "\"storeSupport\"",
            "\"extensionsPage\"",
            "\"extensionOnDisk\"",
            "\"needsAttention\"",
            "\"anyActive\"",
            "\"onboardingDismissed\"",
        ] {
            assert!(json.contains(key), "missing {key} in {json}");
        }
    }

    #[test]
    fn errors_serialize_with_a_machine_readable_kind() {
        let json = serde_json::to_string(&SetupError::NotInstalled("brave".into())).unwrap();
        assert_eq!(json, r#"{"kind":"notInstalled","browserId":"brave"}"#);
    }

    #[test]
    fn errors_render_readable_messages() {
        assert_eq!(
            SetupError::Unsupported("firefox".into()).to_string(),
            "firefox cannot install extensions from the Chrome Web Store"
        );
    }
}
