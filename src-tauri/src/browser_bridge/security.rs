//! Bridge security (Phase 5): Origin allowlist + optional pairing token, plus the
//! string→`MediaAction` mapping used when re-emitting queued commands as v2 frames.
//!
//! Loopback binding is *not* a trust boundary — any local process can connect —
//! so the WS upgrade is gated on the `Origin` header, and (when configured) a
//! pairing token carried on `hello`.

use std::sync::OnceLock;

use super::protocol::frames::MediaAction;

/// Pinned Chromium extension origins — the published PilPod Companion.
///
/// The Chrome Web Store ID is stable across every Chromium browser in
/// `browser_catalog`: Chrome, Edge, Brave, Vivaldi, Opera, Arc and Yandex all
/// install the same store item and keep the same ID. An empty list means
/// "accept any Chromium extension".
///
/// Firefox is deliberately *not* here, and cannot be: Gecko assigns a fresh
/// random UUID to `moz-extension://` per installation, so there is no stable
/// value to pin against. See [`origin_allowed`].
const ALLOWED_EXTENSION_ORIGINS: &[&str] =
    &["chrome-extension://ooogjmdnagfepkocppnldkafbcbmdhal"];

/// Optional pairing token. Set once at startup from the app config dir; `None`
/// means "unpaired" and only the Origin check applies.
static PAIRING_TOKEN: OnceLock<Option<String>> = OnceLock::new();

/// Install the pairing token (call once during setup). Safe to skip entirely.
/// Not wired into a command yet — kept for the planned pairing feature.
#[allow(dead_code)]
pub fn set_pairing_token(token: Option<String>) {
    let _ = PAIRING_TOKEN.set(token);
}

/// Validate the WS upgrade `Origin`.
///
/// What this check is, and what it is not: a browser *forces* a real `http(s)`
/// origin onto a web page, which is why this reliably keeps pages off the
/// bridge. It authenticates nothing — a native process on this machine sends
/// whatever `Origin` header it likes, including a plausible `moz-extension://`
/// UUID. Pinning the Chromium ID keeps a *rogue extension* out; keeping local
/// software out is the pairing token's job (see [`token_ok`]).
pub fn origin_allowed(origin: &str) -> bool {
    // No Origin header at all. Only a native client does this — never a
    // browser. Allowed while developing so `wscat` and friends still work,
    // refused in a shipped build where the only legitimate peer is the
    // companion extension, and it always sends one.
    if origin.is_empty() {
        return cfg!(debug_assertions);
    }
    // Gecko: per-installation random UUID, nothing to pin against.
    if origin.starts_with("moz-extension://") {
        return true;
    }
    if origin.starts_with("chrome-extension://") {
        return ALLOWED_EXTENSION_ORIGINS.is_empty()
            || ALLOWED_EXTENSION_ORIGINS.contains(&origin);
    }
    // Web pages (http/https) and anything else.
    false
}

/// Validate the `hello.token`. Accepts everything when no token is configured.
pub fn token_ok(token: Option<&str>) -> bool {
    match PAIRING_TOKEN.get().and_then(|o| o.as_deref()) {
        None => true,                       // unpaired — Origin check is the only gate
        Some(expected) => token == Some(expected),
    }
}

/// Map a normalized action string (as stored in `BrowserMediaCommand.action`) to
/// the typed `MediaAction`. Returns `None` for unknown actions.
pub fn action_from_str(action: &str) -> Option<MediaAction> {
    Some(match action {
        "playPause" => MediaAction::PlayPause,
        "next" => MediaAction::Next,
        "previous" => MediaAction::Previous,
        "seek" => MediaAction::Seek,
        "setTabVolume" => MediaAction::SetTabVolume,
        "muteTab" => MediaAction::MuteTab,
        "pip" => MediaAction::Pip,
        "focusTab" => MediaAction::FocusTab,
        "focusWindow" => MediaAction::FocusWindow,
        "reactivateTab" => MediaAction::ReactivateTab,
        "reloadTab" => MediaAction::ReloadTab,
        "closeTab" => MediaAction::CloseTab,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The published companion's own origin must always be accepted.
    #[test]
    fn origin_allows_the_pinned_companion() {
        assert!(origin_allowed(
            "chrome-extension://ooogjmdnagfepkocppnldkafbcbmdhal"
        ));
    }

    /// A different Chromium extension is refused now that the ID is pinned.
    /// This is the one thing pinning actually buys.
    #[test]
    fn origin_rejects_other_chromium_extensions() {
        assert!(!origin_allowed("chrome-extension://abc"));
        assert!(!origin_allowed(
            "chrome-extension://aaaagjmdnagfepkocppnldkafbcbmdhal"
        ));
    }

    /// Firefox's per-install UUID cannot be pinned, so any Gecko extension
    /// origin is accepted by design.
    #[test]
    fn origin_allows_any_gecko_extension() {
        assert!(origin_allowed("moz-extension://abc"));
        assert!(origin_allowed(
            "moz-extension://5f3b9a1c-0d2e-4a6b-8c7d-1e2f3a4b5c6d"
        ));
    }

    #[test]
    fn origin_rejects_web_pages() {
        assert!(!origin_allowed("https://evil.example"));
        assert!(!origin_allowed("http://localhost:3000"));
    }

    /// A missing Origin means a native client. Tests build with debug
    /// assertions on — exactly the configuration that still permits it — while
    /// a release build returns false here.
    #[test]
    fn origin_without_a_header_follows_the_build_profile() {
        assert_eq!(origin_allowed(""), cfg!(debug_assertions));
    }

    #[test]
    fn token_ok_when_unpaired() {
        // PAIRING_TOKEN unset in this test process → unpaired.
        assert!(token_ok(None));
        assert!(token_ok(Some("anything")));
    }

    #[test]
    fn action_mapping_round_trips_all() {
        for a in ["playPause", "next", "previous", "seek", "setTabVolume", "muteTab",
                  "pip", "focusTab", "focusWindow", "reactivateTab", "reloadTab", "closeTab"] {
            assert!(action_from_str(a).is_some(), "missing {a}");
        }
        assert!(action_from_str("bogus").is_none());
    }
}
