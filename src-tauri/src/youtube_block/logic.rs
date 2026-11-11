//! Pure rules for the YouTube blocker — no I/O, no Tauri, fully unit-tested.

/// Longest window in which a repeat skip of the same tab+video is suppressed.
/// The extension needs a moment to act on a command and report the new state;
/// without this, every delta arriving in that gap would fire another command.
pub const SKIP_COOLDOWN_MS: u128 = 2_500;

/// After this many `next` attempts on the same tab+video (it is still there),
/// fall back to closing the tab.
pub const MAX_NEXT_ATTEMPTS: u32 = 2;

fn valid_id(s: &str) -> bool {
    s.len() == 11 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn is_youtube_host(host: &str) -> bool {
    host == "youtube.com"
        || host.ends_with(".youtube.com")
        || host == "youtube-nocookie.com"
        || host.ends_with(".youtube-nocookie.com")
}

/// The 11-character video id of a YouTube video URL, or `None` for anything
/// else (home page, search, channel, playlist index, other sites).
///
/// Handles `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/`, `/v/`
/// on youtube.com, m., music. and youtube-nocookie.com.
pub fn video_id(url: &str) -> Option<String> {
    let url = url.trim();
    let scheme_len = if url.get(..8).is_some_and(|p| p.eq_ignore_ascii_case("https://")) {
        8
    } else if url.get(..7).is_some_and(|p| p.eq_ignore_ascii_case("http://")) {
        7
    } else {
        return None;
    };
    let rest = &url[scheme_len..];
    let rest = rest.split('#').next().unwrap_or(rest);
    let (before_query, query) = rest.split_once('?').unwrap_or((rest, ""));
    let (authority, path) = before_query.split_once('/').unwrap_or((before_query, ""));
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host).to_ascii_lowercase();

    let mut segments = path.split('/').filter(|s| !s.is_empty());
    let candidate = if host == "youtu.be" {
        segments.next()
    } else if is_youtube_host(&host) {
        match segments.next()? {
            "watch" => query.split('&').find_map(|kv| kv.strip_prefix("v=")),
            "shorts" | "embed" | "live" | "v" => segments.next(),
            _ => None,
        }
    } else {
        None
    };
    candidate.filter(|id| valid_id(id)).map(str::to_owned)
}

/// Canonical watch URL for a video id (what the blocked list links to).
pub fn watch_url(video_id: &str) -> String {
    format!("https://www.youtube.com/watch?v={video_id}")
}

/// A tab title without YouTube's decoration: `"(3) Song - YouTube"` → `"Song"`.
pub fn clean_title(raw: &str) -> String {
    let mut t = raw.trim();
    for suffix in [" - YouTube Music", " - YouTube"] {
        if let Some(s) = t.strip_suffix(suffix) {
            t = s.trim_end();
            break;
        }
    }
    if let Some(rest) = t.strip_prefix('(') {
        if let Some((n, after)) = rest.split_once(") ") {
            if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) {
                t = after.trim_start();
            }
        }
    }
    t.to_string()
}

/// The user is looking at this tab right now: it is the selected tab of the
/// browser window that has OS focus. Blocking never touches such a tab.
pub fn in_focus(active: bool, window_focused: bool) -> bool {
    active && window_focused
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipAction {
    /// Press the player's "next" — moves on to the next video.
    Next,
    /// Close the tab.
    Close,
}

/// What to do for the `attempt`-th (1-based) skip of a tab.
pub fn choose_action(can_next: bool, attempt: u32) -> SkipAction {
    if can_next && attempt <= MAX_NEXT_ATTEMPTS {
        SkipAction::Next
    } else {
        SkipAction::Close
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_ids_from_every_url_shape() {
        let id = Some("dQw4w9WgXcQ".to_string());
        for url in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
            "https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM",
            "https://youtu.be/dQw4w9WgXcQ?si=abc",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
            "https://www.youtube.com/live/dQw4w9WgXcQ#frag",
            "HTTP://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ",
        ] {
            assert_eq!(video_id(url), id, "{url}");
        }
    }

    #[test]
    fn rejects_everything_that_is_not_a_video() {
        for url in [
            "",
            "https://www.youtube.com/",
            "https://www.youtube.com/results?search_query=x",
            "https://www.youtube.com/@channel",
            "https://www.youtube.com/playlist?list=PL123",
            "https://www.youtube.com/watch",
            "https://www.youtube.com/watch?v=short",
            "https://example.com/watch?v=dQw4w9WgXcQ",
            "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
            "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
            "about:blank",
        ] {
            assert_eq!(video_id(url), None, "{url}");
        }
    }

    #[test]
    fn cleans_titles() {
        assert_eq!(clean_title("Song - YouTube"), "Song");
        assert_eq!(clean_title("(3) Song - YouTube"), "Song");
        assert_eq!(clean_title("Song - YouTube Music"), "Song");
        assert_eq!(clean_title("  Plain  "), "Plain");
        assert_eq!(clean_title("(beta) Keep"), "(beta) Keep");
        assert_eq!(clean_title(""), "");
    }

    #[test]
    fn focus_needs_both_flags() {
        assert!(in_focus(true, true));
        assert!(!in_focus(true, false));
        assert!(!in_focus(false, true));
        assert!(!in_focus(false, false));
    }

    #[test]
    fn falls_back_to_close() {
        assert_eq!(choose_action(true, 1), SkipAction::Next);
        assert_eq!(choose_action(true, MAX_NEXT_ATTEMPTS), SkipAction::Next);
        assert_eq!(choose_action(true, MAX_NEXT_ATTEMPTS + 1), SkipAction::Close);
        assert_eq!(choose_action(false, 1), SkipAction::Close);
    }

    #[test]
    fn watch_url_round_trips() {
        assert_eq!(video_id(&watch_url("dQw4w9WgXcQ")).as_deref(), Some("dQw4w9WgXcQ"));
    }
}
