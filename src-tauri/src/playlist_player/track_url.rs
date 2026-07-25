//! Player-tab URL preparation.
//!
//! A track saved from inside a site playlist keeps that context in its URL
//! (YouTube: `&list=`, `&index=`, `&start_radio=` …). Loading it verbatim makes
//! the SITE sequence the next video and fight PilPod's playlist. The player
//! therefore strips playlist/radio context before every `open`/`nav`: the tab
//! plays exactly ONE item and PilPod owns all sequencing.

/// Query keys that bind a YouTube URL to a site-side playlist / radio / queue.
const YT_PLAYLIST_PARAMS: &[&str] = &["list", "index", "start_radio", "playnext", "pp"];

fn is_youtube_host(host: &str) -> bool {
    host == "youtu.be"
        || host.ends_with("youtube.com")
        || host.ends_with("youtube-nocookie.com")
}

/// Strip site-playlist context from `url` (currently YouTube-family hosts).
/// Non-YouTube URLs and unparsable input pass through unchanged. The fragment
/// is dropped for stripped URLs (never load-bearing on YouTube watch pages).
pub fn sanitize_track_url(url: &str) -> String {
    let trimmed = url.trim();
    let Some(scheme_end) = trimmed.find("://") else {
        return trimmed.to_string();
    };
    let after = &trimmed[scheme_end + 3..];
    let host_end = after
        .find(['/', '?', '#'])
        .unwrap_or(after.len());
    let host = after[..host_end]
        .rsplit('@')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if !is_youtube_host(&host) {
        return trimmed.to_string();
    }

    let base = trimmed.split('#').next().unwrap_or(trimmed);
    let (path, query) = match base.find('?') {
        Some(i) => (&base[..i], &base[i + 1..]),
        None => (base, ""),
    };
    if query.is_empty() {
        return base.to_string();
    }
    let kept: Vec<&str> = query
        .split('&')
        .filter(|kv| !kv.is_empty())
        .filter(|kv| {
            let key = kv.split('=').next().unwrap_or("").to_ascii_lowercase();
            !YT_PLAYLIST_PARAMS.contains(&key.as_str())
        })
        .collect();
    if kept.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{}", kept.join("&"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_youtube_playlist_context() {
        assert_eq!(
            sanitize_track_url(
                "https://www.youtube.com/watch?v=abc123&list=PLxyz&index=4&pp=ygUE"
            ),
            "https://www.youtube.com/watch?v=abc123"
        );
        assert_eq!(
            sanitize_track_url("https://music.youtube.com/watch?v=abc&list=RDAMVM"),
            "https://music.youtube.com/watch?v=abc"
        );
        assert_eq!(
            sanitize_track_url("https://www.youtube.com/watch?list=PLxyz&v=abc&start_radio=1"),
            "https://www.youtube.com/watch?v=abc"
        );
    }

    #[test]
    fn keeps_time_offset_and_video_id() {
        assert_eq!(
            sanitize_track_url("https://www.youtube.com/watch?v=abc&t=90s&list=PL1"),
            "https://www.youtube.com/watch?v=abc&t=90s"
        );
    }

    #[test]
    fn watch_url_becomes_bare_path_when_only_playlist_params() {
        assert_eq!(
            sanitize_track_url("https://www.youtube.com/playlist?list=PLxyz"),
            "https://www.youtube.com/playlist"
        );
    }

    #[test]
    fn non_youtube_urls_pass_through() {
        let u = "https://open.spotify.com/track/xyz?si=123&list=whatever";
        assert_eq!(sanitize_track_url(u), u);
        let s = "https://soundcloud.com/a/b#t=30";
        assert_eq!(sanitize_track_url(s), s);
    }

    #[test]
    fn short_links_and_hosts_with_ports_are_handled() {
        assert_eq!(
            sanitize_track_url("https://youtu.be/abc123?list=PLxyz"),
            "https://youtu.be/abc123"
        );
        assert_eq!(sanitize_track_url("not a url"), "not a url");
    }
}
