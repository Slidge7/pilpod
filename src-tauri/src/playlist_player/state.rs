//! Playlist player session — pure state and transitions. No Tauri, no sockets,
//! no locks: everything here is synchronous and unit-tested. `commands.rs` and
//! the bridge observer in `mod.rs` are thin shells that lock, call, emit.

/// Where a session plays. The rest of this file is target-independent: order,
/// shuffle, repeat and the [`Step`] machine behave identically either way.
///
/// * `Browser` — a tab in a connected browser, driven over protocol v2.
/// * `InApp`   — PilPod's own webview window (`inapp_player`), no extension
///   involved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlaybackTarget {
    Browser(String),
    InApp,
}

impl PlaybackTarget {
    /// The extension `browserId` this session drives, if any.
    pub fn browser_id(&self) -> Option<&str> {
        match self {
            Self::Browser(id) => Some(id.as_str()),
            Self::InApp => None,
        }
    }

    pub fn is_in_app(&self) -> bool {
        matches!(self, Self::InApp)
    }

    /// Wire value mirrored in `types.ts`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Browser(_) => "browser",
            Self::InApp => "inApp",
        }
    }
}

/// How the player reached the end-of-track / skip decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepeatMode {
    Off,
    One,
    All,
}

impl RepeatMode {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "off" => Self::Off,
            "one" => Self::One,
            "all" => Self::All,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::One => "one",
            Self::All => "all",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerStatus {
    /// `open` sent, waiting for `opened` (or URL-match adoption).
    Opening,
    /// Player tab known; tracks navigate through it.
    Ready,
    /// Ran off the end with repeat off. Session kept so the user can restart.
    Ended,
    /// Unrecoverable until the user retries (socket gone, open failed…).
    Error,
}

impl PlayerStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Opening => "opening",
            Self::Ready => "ready",
            Self::Ended => "ended",
            Self::Error => "error",
        }
    }
}

/// One playable entry, resolved from the vault at session start.
#[derive(Debug, Clone)]
pub struct PlayerTrack {
    pub item_id: String,
    pub url: String,
    pub normalized_url: String,
    /// Duration captured when the item was saved — a secondary identity
    /// signal: a tab whose media duration matches (±2 s) is "our track" even
    /// if the site rewrote the URL (redirects, youtu.be → youtube.com, …).
    pub expected_dur_secs: Option<f64>,
}

/// Where to go after a skip or track end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Navigate to this position in `order`.
    To(usize),
    /// Re-navigate the current track (repeat-one, or prev at the first track).
    Restart,
    /// Nothing left to play (repeat off, last track).
    Ended,
}

#[derive(Debug, Clone)]
pub struct PlayerSession {
    pub playlist_id: String,
    /// Where this session plays: a connected browser, or PilPod's own webview.
    pub target: PlaybackTarget,
    pub tab_id: Option<i64>,
    pub window_id: Option<i64>,
    pub status: PlayerStatus,
    pub error: Option<String>,
    /// Tracks in playlist order (immutable for the session's lifetime).
    pub tracks: Vec<PlayerTrack>,
    /// Play order: indices into `tracks` (identity, or shuffled).
    pub order: Vec<usize>,
    /// Position within `order`.
    pub pos: usize,
    pub repeat: RepeatMode,
    pub shuffle: bool,
    pub auto_play: bool,
    /// `open` frame id we are waiting to see echoed in `opened`.
    pub pending_open_id: Option<String>,
    /// Wall-clock ms when `open` was sent (Opening timeout).
    pub open_started_ms: u64,
    /// The player tab was observed playing since the last nav (end detection).
    pub was_playing: bool,
    /// Wall-clock ms of the last `open`/`nav` we sent (loading grace window).
    pub last_nav_ms: u64,
    /// Last position/duration observed while PLAYING since the last nav.
    /// Authoritative end evidence: the media object itself vanishes during
    /// navigation/SPA URL churn, so its absence must never imply "ended".
    pub last_seen_ct: f64,
    pub last_seen_dur: f64,
    /// Normalized URL the player tab actually settled on after our nav
    /// (redirect target). Counts as "on our track" alongside the saved URL.
    pub landing_normalized: Option<String>,
}

impl PlayerSession {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        playlist_id: String,
        target: PlaybackTarget,
        tracks: Vec<PlayerTrack>,
        shuffle: bool,
        repeat: RepeatMode,
        auto_play: bool,
        now_ms: u64,
        seed: u64,
    ) -> Self {
        let mut order: Vec<usize> = (0..tracks.len()).collect();
        if shuffle {
            shuffle_in_place(&mut order, seed);
        }
        Self {
            playlist_id,
            target,
            tab_id: None,
            window_id: None,
            status: PlayerStatus::Opening,
            error: None,
            tracks,
            order,
            pos: 0,
            repeat,
            shuffle,
            auto_play,
            pending_open_id: None,
            open_started_ms: now_ms,
            was_playing: false,
            last_nav_ms: now_ms,
            last_seen_ct: 0.0,
            last_seen_dur: 0.0,
            landing_normalized: None,
        }
    }

    /// Convenience for the bridge observer, which is browser-only.
    pub fn browser_id(&self) -> Option<&str> {
        self.target.browser_id()
    }

    pub fn current_track(&self) -> Option<&PlayerTrack> {
        self.order.get(self.pos).and_then(|&i| self.tracks.get(i))
    }

    pub fn track_at(&self, pos: usize) -> Option<&PlayerTrack> {
        self.order.get(pos).and_then(|&i| self.tracks.get(i))
    }

    /// Next step when the current track finished by itself (auto-advance).
    pub fn auto_step(&self) -> Step {
        match self.repeat {
            RepeatMode::One => Step::Restart,
            _ => self.forward_step(),
        }
    }

    /// Next step for a user-initiated "next" (repeat-one never traps a skip).
    pub fn next_step(&self) -> Step {
        self.forward_step()
    }

    fn forward_step(&self) -> Step {
        if self.pos + 1 < self.order.len() {
            Step::To(self.pos + 1)
        } else if self.repeat == RepeatMode::All && !self.order.is_empty() {
            Step::To(0)
        } else {
            Step::Ended
        }
    }

    /// Step for a user-initiated "previous".
    pub fn prev_step(&self) -> Step {
        if self.pos > 0 {
            Step::To(self.pos - 1)
        } else if self.repeat == RepeatMode::All && self.order.len() > 1 {
            Step::To(self.order.len() - 1)
        } else {
            Step::Restart
        }
    }

    /// Map a playlist item id to its position in the current play order.
    pub fn pos_of_item(&self, item_id: &str) -> Option<usize> {
        let track_idx = self.tracks.iter().position(|t| t.item_id == item_id)?;
        self.order.iter().position(|&i| i == track_idx)
    }

    /// Toggle shuffle, rebuilding the play order. Turning shuffle ON keeps the
    /// current track first (playback is uninterrupted); turning it OFF returns
    /// to playlist order with `pos` pointing at the same track.
    pub fn set_shuffle(&mut self, on: bool, seed: u64) {
        if on == self.shuffle {
            return;
        }
        let current = self.order.get(self.pos).copied();
        self.shuffle = on;
        if on {
            let mut rest: Vec<usize> =
                (0..self.tracks.len()).filter(|&i| Some(i) != current).collect();
            shuffle_in_place(&mut rest, seed);
            self.order = current.into_iter().chain(rest).collect();
            self.pos = 0;
        } else {
            self.order = (0..self.tracks.len()).collect();
            self.pos = current.unwrap_or(0).min(self.order.len().saturating_sub(1));
        }
    }
}

/// Fisher–Yates with a xorshift64* generator — deterministic for a given seed
/// (testable), no extra crate for a cosmetic shuffle.
fn shuffle_in_place(v: &mut [usize], seed: u64) {
    let mut s = seed | 1; // xorshift state must be non-zero
    let mut next = move || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        s.wrapping_mul(0x2545_F491_4F6C_DD1D)
    };
    for i in (1..v.len()).rev() {
        let j = (next() % (i as u64 + 1)) as usize;
        v.swap(i, j);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(n: usize, repeat: RepeatMode, shuffle: bool) -> PlayerSession {
        let tracks = (0..n)
            .map(|i| PlayerTrack {
                item_id: format!("m_{i}"),
                url: format!("https://x.test/{i}"),
                normalized_url: format!("x.test/{i}"),
                expected_dur_secs: None,
            })
            .collect();
        PlayerSession::new(
            "p_1".into(),
            PlaybackTarget::Browser("b_1".into()),
            tracks,
            shuffle,
            repeat,
            true,
            1_000,
            42,
        )
    }

    #[test]
    fn target_exposes_browser_id_only_for_browser_sessions() {
        let browser = PlaybackTarget::Browser("b_9".into());
        assert_eq!(browser.browser_id(), Some("b_9"));
        assert_eq!(browser.as_str(), "browser");
        assert!(!browser.is_in_app());

        assert_eq!(PlaybackTarget::InApp.browser_id(), None);
        assert_eq!(PlaybackTarget::InApp.as_str(), "inApp");
        assert!(PlaybackTarget::InApp.is_in_app());
    }

    #[test]
    fn step_machine_is_target_independent() {
        let tracks: Vec<PlayerTrack> = (0..3)
            .map(|i| PlayerTrack {
                item_id: format!("m_{i}"),
                url: format!("https://x.test/{i}"),
                normalized_url: format!("x.test/{i}"),
                expected_dur_secs: None,
            })
            .collect();
        let mut in_app = PlayerSession::new(
            "p_1".into(),
            PlaybackTarget::InApp,
            tracks,
            false,
            RepeatMode::All,
            true,
            1_000,
            42,
        );
        in_app.pos = 2;
        assert_eq!(in_app.next_step(), Step::To(0));
        assert_eq!(in_app.browser_id(), None);
    }

    #[test]
    fn identity_order_without_shuffle() {
        let s = session(4, RepeatMode::Off, false);
        assert_eq!(s.order, vec![0, 1, 2, 3]);
        assert_eq!(s.current_track().unwrap().item_id, "m_0");
    }

    #[test]
    fn shuffle_is_a_permutation() {
        let s = session(8, RepeatMode::Off, true);
        let mut sorted = s.order.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, (0..8).collect::<Vec<_>>());
    }

    #[test]
    fn auto_step_repeat_one_restarts() {
        let s = session(3, RepeatMode::One, false);
        assert_eq!(s.auto_step(), Step::Restart);
        // …but a manual next still moves on.
        assert_eq!(s.next_step(), Step::To(1));
    }

    #[test]
    fn repeat_all_wraps_both_directions() {
        let mut s = session(3, RepeatMode::All, false);
        s.pos = 2;
        assert_eq!(s.next_step(), Step::To(0));
        s.pos = 0;
        assert_eq!(s.prev_step(), Step::To(2));
    }

    #[test]
    fn repeat_off_ends_at_last_track() {
        let mut s = session(3, RepeatMode::Off, false);
        s.pos = 2;
        assert_eq!(s.next_step(), Step::Ended);
        assert_eq!(s.auto_step(), Step::Ended);
        s.pos = 0;
        assert_eq!(s.prev_step(), Step::Restart);
    }

    #[test]
    fn toggling_shuffle_keeps_current_track() {
        let mut s = session(5, RepeatMode::Off, false);
        s.pos = 3;
        let current = s.current_track().unwrap().item_id.clone();
        s.set_shuffle(true, 7);
        assert_eq!(s.pos, 0);
        assert_eq!(s.current_track().unwrap().item_id, current);
        let mut sorted = s.order.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, (0..5).collect::<Vec<_>>());
        s.set_shuffle(false, 9);
        assert_eq!(s.current_track().unwrap().item_id, current);
        assert_eq!(s.order, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn pos_of_item_respects_play_order() {
        let mut s = session(5, RepeatMode::Off, false);
        s.set_shuffle(true, 1234);
        for (pos, &idx) in s.order.iter().enumerate() {
            let id = s.tracks[idx].item_id.clone();
            assert_eq!(s.pos_of_item(&id), Some(pos));
        }
        assert_eq!(s.pos_of_item("missing"), None);
    }

    #[test]
    fn single_track_repeat_all_prev_restarts() {
        let s = session(1, RepeatMode::All, false);
        assert_eq!(s.prev_step(), Step::Restart);
        assert_eq!(s.next_step(), Step::To(0));
    }
}
