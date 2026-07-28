//! Page → Rust channel for the player webview.
//!
//! The player window loads a **remote origin**, which rules out the two obvious
//! transports: a socket/fetch to the local bridge dies on the site's
//! `connect-src` CSP, and Tauri IPC would have to be granted to `https://*`,
//! exposing every app command to whatever page the user plays.
//!
//! Instead the agent navigates to a reserved, non-resolvable host. Chromium
//! does not apply CSP to navigations, and `on_navigation` cancels ours before
//! anything loads — so the page never unloads and no command surface is opened.
//! Swapping in a better channel later means changing `intercept()` and the
//! agent's `send()`; nothing else in the module knows how bytes arrive.

use tauri::AppHandle;

/// Reserved TLD (RFC 2606): guaranteed never to resolve, so even a request that
/// somehow escaped cancellation cannot leave the machine.
pub const IPC_HOST: &str = "pilpod-ipc.invalid";
pub const IPC_ENDPOINT: &str = "https://pilpod-ipc.invalid/r";

/// `on_navigation` hook. Returns false to cancel — i.e. "this was a message,
/// not a navigation".
pub fn intercept(app: &AppHandle, url: &tauri::Url) -> bool {
    if url.host_str() != Some(IPC_HOST) {
        return true;
    }
    if let Some((_, payload)) = url.query_pairs().find(|(k, _)| k.as_ref() == "d") {
        super::on_report(app, payload.as_ref());
    }
    false
}

// ── report parsing ──────────────────────────────────────────────────────────

/// What the agent just told us. Kinds mirror `agent.js`'s `send()` calls.
#[derive(Debug, Clone, PartialEq)]
pub enum Report {
    /// Full state snapshot.
    State(Box<StateReport>),
    /// Lossy progress: position, duration, playing.
    Progress { current_time: f64, duration: f64, playing: bool },
    /// The media element fired `ended` — PilPod advances the playlist.
    Ended,
    /// The user hit the agent's close button.
    Close,
    /// The user grabbed the drag strip.
    Drag,
    /// Page-level notice (unload, media error). Informational.
    Notice(String),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct StateReport {
    pub url: String,
    pub page_title: String,
    pub playback_state: String,
    pub media_title: String,
    pub artist: String,
    pub album: String,
    pub artwork_url: String,
    pub duration: f64,
    pub current_time: f64,
    pub volume_pct: f64,
    pub muted: bool,
    pub can_seek: bool,
    pub can_pip: bool,
    pub in_pip: bool,
    pub has_media: bool,
}

fn s(v: &serde_json::Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn f(v: &serde_json::Value, k: &str) -> f64 {
    let n = v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0);
    if n.is_finite() { n } else { 0.0 }
}

fn b(v: &serde_json::Value, k: &str) -> bool {
    match v.get(k) {
        Some(serde_json::Value::Bool(x)) => *x,
        Some(serde_json::Value::Number(n)) => n.as_f64().unwrap_or(0.0) >= 1.0,
        _ => false,
    }
}

/// Parse one agent message. Returns `None` for anything malformed — a bad
/// report must never take the player down.
pub fn parse(raw: &str) -> Option<Report> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    match v.get("k").and_then(|k| k.as_str())? {
        "s" => {
            let state = playback_state(&s(&v, "st"));
            Some(Report::State(Box::new(StateReport {
                url: s(&v, "u"),
                page_title: s(&v, "t"),
                playback_state: state,
                media_title: s(&v, "mt"),
                artist: s(&v, "ar"),
                album: s(&v, "al"),
                artwork_url: s(&v, "aw"),
                duration: f(&v, "d"),
                current_time: f(&v, "ct"),
                volume_pct: f(&v, "v").clamp(0.0, 600.0),
                muted: b(&v, "mu"),
                can_seek: b(&v, "cs"),
                can_pip: b(&v, "cp"),
                in_pip: b(&v, "pip"),
                has_media: b(&v, "hm"),
            })))
        }
        "p" => Some(Report::Progress {
            current_time: f(&v, "ct"),
            duration: f(&v, "d"),
            playing: b(&v, "st"),
        }),
        "e" => Some(Report::Ended),
        "x" => Some(Report::Close),
        "g" => Some(Report::Drag),
        "r" => Some(Report::Notice(s(&v, "m"))),
        _ => None,
    }
}

/// Normalise to the three states the whole app uses.
fn playback_state(raw: &str) -> String {
    match raw {
        "playing" => "playing".into(),
        "paused" => "paused".into(),
        _ => "none".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_state_report() {
        let raw = r#"{"k":"s","u":"https://x.test/a","t":"Page","st":"playing",
            "mt":"Song","ar":"Artist","al":"Album","aw":"https://x.test/art.jpg",
            "d":210.5,"ct":12.25,"v":80,"mu":false,"cs":true,"cp":false,"pip":false,"hm":true}"#;
        let Some(Report::State(st)) = parse(raw) else { panic!("expected state") };
        assert_eq!(st.url, "https://x.test/a");
        assert_eq!(st.playback_state, "playing");
        assert_eq!(st.media_title, "Song");
        assert_eq!(st.duration, 210.5);
        assert_eq!(st.volume_pct, 80.0);
        assert!(st.can_seek && st.has_media && !st.in_pip);
    }

    #[test]
    fn parses_progress_and_events() {
        assert_eq!(
            parse(r#"{"k":"p","ct":5.5,"d":100,"st":1}"#),
            Some(Report::Progress { current_time: 5.5, duration: 100.0, playing: true })
        );
        assert_eq!(parse(r#"{"k":"e"}"#), Some(Report::Ended));
        assert_eq!(parse(r#"{"k":"x"}"#), Some(Report::Close));
        assert_eq!(parse(r#"{"k":"g"}"#), Some(Report::Drag));
        assert_eq!(parse(r#"{"k":"r","m":"unload"}"#), Some(Report::Notice("unload".into())));
    }

    #[test]
    fn malformed_input_is_ignored_not_fatal() {
        assert!(parse("").is_none());
        assert!(parse("not json").is_none());
        assert!(parse("{}").is_none());
        assert!(parse(r#"{"k":"zzz"}"#).is_none());
        assert!(parse(r#"[1,2,3]"#).is_none());
    }

    #[test]
    fn non_finite_and_out_of_range_numbers_are_tamed() {
        let Some(Report::State(st)) = parse(r#"{"k":"s","st":"paused","d":null,"v":99999}"#) else {
            panic!("expected state")
        };
        assert_eq!(st.duration, 0.0);
        assert_eq!(st.volume_pct, 600.0);
        assert_eq!(st.playback_state, "paused");
    }

    #[test]
    fn unknown_playback_state_falls_back_to_none() {
        let Some(Report::State(st)) = parse(r#"{"k":"s","st":"buffering"}"#) else {
            panic!("expected state")
        };
        assert_eq!(st.playback_state, "none");
    }
}
