//! In-app player state — pure data, no Tauri, no locks.
//!
//! The agent injected into the player webview reports the same information the
//! companion extension reports for a browser tab. This module holds the last
//! report and maps it onto the *existing* `BrowserTab` / `TabMedia` shapes so
//! the whole desktop UI (media cards, seek bar, volume, playlist card) drives
//! the in-app player without knowing it exists.

use crate::browser_dto::{BrowserTab, TabMedia, DetectedBrowser, windows_for_tabs};

/// Synthetic `browserId` for the in-app player. Never collides with the
/// extension's UUIDs, and `browser_media_control` routes on it.
pub const INAPP_BROWSER_ID: &str = "pilpod-inapp";
/// The player window hosts exactly one "tab"; ids are constants.
pub const INAPP_TAB_ID: i64 = 1;
pub const INAPP_WINDOW_ID: i64 = 1;
pub const INAPP_DISPLAY_NAME: &str = "PilPod Player";
/// `osBrowserId` used for icon/metadata lookups on the frontend.
pub const INAPP_OS_ID: &str = "pilpod";

/// Last known state of the page inside the player webview.
#[derive(Debug, Clone, PartialEq)]
pub struct InAppSession {
    pub url: String,
    pub page_title: String,
    /// `playing` | `paused` | `none`
    pub playback_state: String,
    pub media_title: String,
    pub artist: String,
    pub album: String,
    pub artwork_url: String,
    pub duration: f64,
    pub current_time: f64,
    /// Tab volume as a percentage (0–600), same units as the extension.
    pub tab_volume: f64,
    pub tab_muted: bool,
    pub can_seek: bool,
    pub can_pip: bool,
    pub in_pip: bool,
    /// False until the agent has found a media element on the page.
    pub has_media: bool,
    /// Volume/mute carried across a track change. A freshly loaded page starts
    /// at the media element's default, so the user's choice is re-applied once
    /// the next track reports media. `None` ⇒ nothing to restore.
    pub pending_audio: Option<(f64, bool)>,
    /// The track's own URL, kept because the stage may be showing a rewritten
    /// one (YouTube tracks stage as embeds). Used to fall back to the real page
    /// when a video refuses to embed.
    pub original_url: String,
    /// The fallback has been used for this track — never loop between the two.
    pub fell_back: bool,
    /// Set when the track plays through PilPod's own stage page (YouTube, via
    /// the IFrame API). `None` ⇒ the stage is showing a site's own page.
    pub video_id: Option<String>,
}

impl Default for InAppSession {
    fn default() -> Self {
        Self {
            url: String::new(),
            page_title: String::new(),
            playback_state: "none".into(),
            media_title: String::new(),
            artist: String::new(),
            album: String::new(),
            artwork_url: String::new(),
            duration: 0.0,
            current_time: 0.0,
            tab_volume: 100.0,
            tab_muted: false,
            can_seek: false,
            can_pip: false,
            in_pip: false,
            has_media: false,
            pending_audio: None,
            original_url: String::new(),
            fell_back: false,
            video_id: None,
        }
    }
}

impl InAppSession {
    /// A new session for `url` (the track's own URL) before the agent has
    /// reported anything. `staged` is what the stage actually loads.
    pub fn opening_staged(url: &str, staged: &str) -> Self {
        Self {
            url: staged.to_string(),
            original_url: url.to_string(),
            ..Default::default()
        }
    }

    /// A new session pointed at `url` before the agent has reported anything.
    pub fn opening(url: &str) -> Self {
        Self::opening_staged(url, url)
    }

    /// Same, but carrying the volume of the track that just finished.
    ///
    /// Mute is deliberately NOT carried. Sites mute themselves to satisfy
    /// autoplay policies, and carrying that forward turned one muted page into
    /// a session that re-muted every following track — a ratchet with no way
    /// out. Volume is the setting a user actually chose; mute is noise.
    pub fn next_track(url: &str, staged: &str, previous: Option<&InAppSession>) -> Self {
        let mut next = Self::opening_staged(url, staged);
        if let Some(prev) = previous {
            next.tab_volume = prev.tab_volume;
            next.pending_audio = Some((prev.tab_volume, false));
        }
        next
    }

    /// Fold in a report from PilPod's own stage page. Fields the stage does not
    /// know about (PiP, album) are left as they are.
    pub fn apply_stage(&mut self, r: &super::dto::StageReport) {
        self.playback_state = match r.playback_state.as_str() {
            "playing" => "playing".into(),
            "paused" => "paused".into(),
            _ => "none".into(),
        };
        self.media_title = r.title.clone();
        self.artist = r.artist.clone();
        self.artwork_url = r.artwork_url.clone();
        self.duration = if r.duration.is_finite() && r.duration > 0.0 {
            r.duration
        } else {
            0.0
        };
        self.current_time = if r.current_time.is_finite() {
            r.current_time
        } else {
            0.0
        };
        self.tab_volume = r.volume.clamp(0.0, 600.0);
        self.tab_muted = r.muted;
        self.has_media = r.has_media;
        self.can_seek = self.duration > 0.0;
        // The stage page owns a player API, not a video element: PiP is not
        // reachable from it.
        self.can_pip = false;
        self.in_pip = false;
    }

    /// Audio settings to push once, if the freshly loaded page came up with
    /// different ones. Clears the pending value.
    pub fn take_audio_fix(&mut self) -> Option<(f64, bool)> {
        let (volume, muted) = self.pending_audio?;
        if !self.has_media {
            return None;
        }
        self.pending_audio = None;
        let drifted = (self.tab_volume - volume).abs() > 1.0 || self.tab_muted != muted;
        drifted.then_some((volume, muted))
    }

    /// Everything that changes the *look* of the UI except playback position.
    /// Position moves constantly while playing and is emitted on a throttle;
    /// anything in this signature is emitted immediately.
    pub fn state_sig(&self) -> (String, String, String, u64, bool, bool, bool, bool) {
        (
            self.url.clone(),
            self.playback_state.clone(),
            format!("{}\u{1}{}\u{1}{}", self.media_title, self.artist, self.artwork_url),
            self.duration.to_bits(),
            self.tab_muted,
            self.can_seek,
            self.in_pip,
            self.has_media,
        )
    }

    pub fn is_playing(&self) -> bool {
        self.playback_state == "playing"
    }

    /// Map onto the extension-shaped tab the rest of PilPod consumes.
    pub fn to_tab(&self) -> BrowserTab {
        let title = if self.page_title.is_empty() {
            self.media_title.clone()
        } else {
            self.page_title.clone()
        };
        BrowserTab {
            tab_id: INAPP_TAB_ID,
            window_id: INAPP_WINDOW_ID,
            url: self.url.clone(),
            title,
            favicon_url: String::new(),
            tab_state: "complete".into(),
            active: true,
            window_focused: false,
            audible: self.is_playing() && !self.tab_muted,
            muted: self.tab_muted,
            pinned: false,
            index: 0,
            media: self.has_media.then(|| TabMedia {
                playback_state: self.playback_state.clone(),
                title: self.media_title.clone(),
                artist: self.artist.clone(),
                album: self.album.clone(),
                artwork_url: self.artwork_url.clone(),
                duration: self.duration,
                current_time: self.current_time,
                page_visible: true,
                user_idle_ms: 0,
                document_state: "complete".into(),
                tab_volume: self.tab_volume,
                tab_muted: self.tab_muted,
                can_seek: self.can_seek,
                can_pip: self.can_pip,
                // PilPod owns sequencing — never the page.
                can_next: false,
                can_prev: false,
                in_pip: self.in_pip,
            }),
            browser_id: INAPP_BROWSER_ID.into(),
        }
    }

    /// The player as a one-tab "browser" row for `browsers://update`.
    pub fn to_detected_browser(&self) -> DetectedBrowser {
        let tabs = vec![self.to_tab()];
        DetectedBrowser {
            id: INAPP_BROWSER_ID.into(),
            os_browser_id: INAPP_OS_ID.into(),
            display_name: INAPP_DISPLAY_NAME.into(),
            profile_label: None,
            running: true,
            // The in-app player has no extension to install or lose — it is
            // connected for as long as the session exists.
            extension_installed: true,
            extension_connected: true,
            tab_count: 1,
            windows: windows_for_tabs(&tabs),
            tabs,
            last_sync_secs: Some(0),
            extension_reconnecting: false,
            icon_url: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn playing() -> InAppSession {
        InAppSession {
            url: "https://m.youtube.com/watch?v=abc".into(),
            page_title: "Some Song - YouTube".into(),
            playback_state: "playing".into(),
            media_title: "Some Song".into(),
            artist: "Some Artist".into(),
            duration: 210.0,
            current_time: 12.0,
            can_seek: true,
            has_media: true,
            ..Default::default()
        }
    }

    #[test]
    fn maps_to_a_tab_the_ui_understands() {
        let tab = playing().to_tab();
        assert_eq!(tab.browser_id, INAPP_BROWSER_ID);
        assert_eq!(tab.tab_id, INAPP_TAB_ID);
        assert!(tab.audible);
        let media = tab.media.expect("media present");
        assert_eq!(media.playback_state, "playing");
        assert_eq!(media.current_time, 12.0);
        // Sequencing stays with PilPod.
        assert!(!media.can_next && !media.can_prev);
    }

    #[test]
    fn no_media_element_means_no_media_block() {
        let s = InAppSession::opening("https://example.test/");
        let tab = s.to_tab();
        assert!(tab.media.is_none());
        assert!(!tab.audible);
    }

    #[test]
    fn progress_alone_does_not_change_the_state_signature() {
        let a = playing();
        let mut b = a.clone();
        b.current_time = 99.0;
        assert_eq!(a.state_sig(), b.state_sig());
        b.playback_state = "paused".into();
        assert_ne!(a.state_sig(), b.state_sig());
    }

    #[test]
    fn volume_survives_a_track_change() {
        let mut prev = playing();
        prev.tab_volume = 40.0;

        let mut next = InAppSession::next_track("https://x.test/2", "https://x.test/2", Some(&prev));
        assert_eq!(next.tab_volume, 40.0);
        // Nothing to fix until the new page reports media.
        assert_eq!(next.take_audio_fix(), None);

        // The fresh page came up at full volume → push the user's choice back.
        next.has_media = true;
        next.tab_volume = 100.0;
        assert_eq!(next.take_audio_fix(), Some((40.0, false)));
        // …and only once.
        assert_eq!(next.take_audio_fix(), None);
    }

    #[test]
    fn a_muted_page_never_mutes_the_next_track() {
        let mut prev = playing();
        prev.tab_muted = true; // the site muted itself for autoplay

        let mut next = InAppSession::next_track("https://x.test/2", "https://x.test/2", Some(&prev));
        assert!(!next.tab_muted, "mute must not ratchet across tracks");
        next.has_media = true;
        // The restore that is queued unmutes rather than re-mutes.
        assert_eq!(next.pending_audio, Some((prev.tab_volume, false)));
    }

    #[test]
    fn matching_audio_needs_no_fix() {
        let mut prev = playing();
        prev.tab_volume = 55.0;
        let mut next = InAppSession::next_track("https://x.test/2", "https://x.test/2", Some(&prev));
        next.has_media = true;
        next.tab_volume = 55.0;
        assert_eq!(next.take_audio_fix(), None);
    }

    #[test]
    fn detected_browser_row_has_exactly_one_tab() {
        let row = playing().to_detected_browser();
        assert_eq!(row.id, INAPP_BROWSER_ID);
        assert_eq!(row.tab_count, 1);
        assert_eq!(row.tabs.len(), 1);
        assert_eq!(row.windows.len(), 1);
        assert!(row.extension_connected);
    }
}
