//! Bridge security (Phase 5): Origin allowlist + optional pairing token, plus the
//! string→`MediaAction` mapping used when re-emitting queued commands as v2 frames.
//!
//! Loopback binding is *not* a trust boundary — any local process can connect —
//! so the WS upgrade is gated on the `Origin` header, and (when configured) a
//! pairing token carried on `hello`.

use std::sync::OnceLock;

use super::protocol::frames::MediaAction;

/// Pinned extension origins. When empty, any `chrome-extension://` /
/// `moz-extension://` origin is accepted (web-page origins are always rejected).
/// Populate with the published extension IDs to lock this down, e.g.
/// `"chrome-extension://abcdef…"`.
const ALLOWED_EXTENSION_ORIGINS: &[&str] = &[];

/// Optional pairing token. Set once at startup from the app config dir; `None`
/// means "unpaired" and only the Origin check applies.
static PAIRING_TOKEN: OnceLock<Option<String>> = OnceLock::new();

/// Install the pairing token (call once during setup). Safe to skip entirely.
/// Not wired into a command yet — kept for the planned pairing feature.
#[allow(dead_code)]
pub fn set_pairing_token(token: Option<String>) {
    let _ = PAIRING_TOKEN.set(token);
}

/// Validate the WS upgrade `Origin`. CLI tools (wscat) send no Origin and are
/// allowed for local testing; browser web pages always send an http(s) Origin
/// and are rejected. Extension origins are accepted (optionally pinned).
pub fn origin_allowed(origin: &str) -> bool {
    if origin.is_empty() {
        return true; // no Origin header (native CLI client) — loopback already enforced
    }
    let is_extension =
        origin.starts_with("chrome-extension://") || origin.starts_with("moz-extension://");
    if !is_extension {
        return false;
    }
    if ALLOWED_EXTENSION_ORIGINS.is_empty() {
        return true;
    }
    ALLOWED_EXTENSION_ORIGINS.contains(&origin)
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

    #[test]
    fn origin_rejects_web_pages_allows_extensions_and_cli() {
        assert!(origin_allowed("chrome-extension://abc"));
        assert!(origin_allowed("moz-extension://abc"));
        assert!(origin_allowed("")); // CLI, no Origin
        assert!(!origin_allowed("https://evil.example"));
        assert!(!origin_allowed("http://localhost:3000"));
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
