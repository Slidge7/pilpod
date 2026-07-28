//! Playlist player — plays a vault playlist through ONE dedicated browser tab.
//!
//! Rust owns the playback session (current track, order, repeat/shuffle/
//! auto-play); the frontend renders `player://update` and calls the
//! `player_*` commands. The session is driven over protocol v2's `open`/`nav`
//! frames (see `PROTOCOL.md` §1/§2 and `docs/PLAYLIST_PLAYER_COMPANION_SPEC.md`).
//!
//! INTEGRATION SEAMS (kept deliberately small):
//!   * `app/setup.rs`      — `init()` registers the managed handle (Windows).
//!   * `app/handlers.rs`   — command registration.
//!   * `browser_bridge/ws.rs` — `observe_tabs()` after every ingest and
//!     `on_opened()` on the `opened` frame. Both are cheap no-ops (one
//!     try_state + one uncontended mutex lock) while no session is active,
//!     so the hot tab-sync path stays flat.
//!
//! Reads the vault via its public `VaultStateHandle` snapshot — never mutates
//! vault data. Windows-only (rides the browser bridge); non-Windows builds get
//! stubs in `platform/stub_commands.rs`.

pub mod commands;
pub mod dto;
pub mod state;
pub mod track_url;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager};

use crate::browser_bridge::protocol::frames::ServerMsg;
use crate::browser_bridge::{push_ws_frame, WsConnectionMap};
use crate::browser_dto::BrowserTab;
use dto::PlayerStateDto;
use state::{PlaybackTarget, PlayerSession, PlayerStatus, Step};

/// Full-snapshot player state event.
pub const EVT_UPDATE: &str = "player://update";

/// A track counts as finished when it pauses/loses media within this many
/// seconds of its known duration.
const END_EPSILON_SECS: f64 = 1.5;
/// A track must have visibly played past this position before it can "end" —
/// blocks phantom ends from load-time state churn (ads, redirects, buffering).
const MIN_TRACK_PLAY_SECS: f64 = 2.0;
/// Ignore playback-state churn for this long after we navigate the player tab
/// (page unload/load flaps `media` on the way through).
const NAV_GRACE_MS: u64 = 3_500;
/// After our nav, URL changes within this window are treated as the track's
/// own redirects (youtu.be → youtube.com, consent, params) and adopted.
const LANDING_WINDOW_MS: u64 = 15_000;
/// Site-hijack takeover: if the tab leaves our track's URL and the track had
/// played to within this many seconds of its duration, the site auto-advanced
/// on its own (YouTube playlist/autoplay) — PilPod takes the tab back.
const HIJACK_EPSILON_SECS: f64 = 5.0;
/// Tolerance when matching a tab's media duration against the saved track
/// duration (secondary identity signal).
const DUR_MATCH_EPSILON_SECS: f64 = 2.0;
/// A media duration is plausible for the current track when it is within this
/// of the saved duration, or longer. Pre-roll ads report a much SHORTER
/// duration — their "end" must never count as the track's end.
const DUR_PLAUSIBLE_EPSILON_SECS: f64 = 30.0;

/// Trust a live media duration as belonging to the current track?
/// Unknown saved duration ⇒ trust everything (best effort).
fn duration_plausible(expected: Option<f64>, dur: f64) -> bool {
    match expected {
        Some(exp) if exp > 0.0 => (dur - exp).abs() <= DUR_PLAUSIBLE_EPSILON_SECS || dur >= exp,
        _ => true,
    }
}
/// Give up on an unanswered `open` after this long.
const OPEN_TIMEOUT_MS: u64 = 15_000;

pub struct PlayerState {
    session: Mutex<Option<PlayerSession>>,
    /// Monotonic id source for `open`/`nav` frame ids.
    seq: AtomicU64,
}

pub type PlayerHandle = Arc<PlayerState>;

impl PlayerState {
    fn new() -> Self {
        Self {
            session: Mutex::new(None),
            seq: AtomicU64::new(1),
        }
    }

    fn next_id(&self, prefix: &str) -> String {
        format!("{prefix}-{}", self.seq.fetch_add(1, Ordering::Relaxed))
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Register the managed handle. Called from `app/setup.rs`.
pub fn init(app: &mut tauri::App) {
    app.manage::<PlayerHandle>(Arc::new(PlayerState::new()));
}

/// Emit the current player snapshot. Callers emit *after* releasing the
/// session lock (same discipline as the vault).
fn emit(app: &AppHandle, dto: &PlayerStateDto) {
    if let Err(e) = app.emit(EVT_UPDATE, dto) {
        log::warn!("[player] emit update failed: {e}");
    }
}

fn dto_of(guard: &Option<PlayerSession>) -> PlayerStateDto {
    guard
        .as_ref()
        .map(PlayerStateDto::from_session)
        .unwrap_or_else(PlayerStateDto::idle)
}

/// Move the player to `pos` on whichever target the session uses. Mutates the
/// session's position/bookkeeping. Returns false when the target is gone (the
/// session is flipped to Error).
fn navigate(
    app: &AppHandle,
    session: &mut PlayerSession,
    ws: &WsConnectionMap,
    handle: &PlayerState,
    pos: usize,
) -> bool {
    let Some(url) = session.track_at(pos).map(|t| t.url.clone()) else {
        return false;
    };

    let delivered = match &session.target {
        // In-app: PilPod owns the webview, so navigation cannot "fail" here —
        // a missing window surfaces as `on_inapp_closed`, not as an error.
        PlaybackTarget::InApp => {
            crate::inapp_player::navigate(app, &url);
            true
        }
        PlaybackTarget::Browser(browser_id) => {
            let Some(tab_id) = session.tab_id else { return false };
            let frame = ServerMsg::Nav {
                id: handle.next_id("n"),
                tab_id,
                url,
            };
            push_ws_frame(ws, browser_id, &frame)
        }
    };

    if delivered {
        session.pos = pos;
        session.status = PlayerStatus::Ready;
        session.error = None;
        session.was_playing = false;
        session.last_nav_ms = now_ms();
        session.last_seen_ct = 0.0;
        session.last_seen_dur = 0.0;
        session.landing_normalized = None;
        true
    } else {
        session.status = PlayerStatus::Error;
        session.error = Some("browser_disconnected".into());
        false
    }
}

/// Apply a [`Step`] (manual skip or auto-advance). Returns true when the
/// session content changed (caller emits).
fn apply_step(
    app: &AppHandle,
    session: &mut PlayerSession,
    ws: &WsConnectionMap,
    handle: &PlayerState,
    step: Step,
) -> bool {
    match step {
        Step::To(pos) => {
            navigate(app, session, ws, handle, pos);
            true
        }
        Step::Restart => {
            let pos = session.pos;
            navigate(app, session, ws, handle, pos);
            true
        }
        Step::Ended => {
            if session.status != PlayerStatus::Ended {
                session.status = PlayerStatus::Ended;
                session.was_playing = false;
                return true;
            }
            false
        }
    }
}

/// `opened` frame arrived — bind the created tab to the waiting session.
pub fn on_opened(
    app: &AppHandle,
    browser_id: &str,
    open_id: &str,
    ok: bool,
    tab_id: Option<i64>,
    window_id: Option<i64>,
    error: Option<String>,
) {
    let Some(handle) = app.try_state::<PlayerHandle>() else { return };
    let dto = {
        let Ok(mut guard) = handle.session.lock() else { return };
        let Some(session) = guard.as_mut() else { return };
        if session.browser_id() != Some(browser_id)
            || session.pending_open_id.as_deref() != Some(open_id)
        {
            return;
        }
        session.pending_open_id = None;
        if ok && tab_id.is_some() {
            session.tab_id = tab_id;
            session.window_id = window_id;
            session.status = PlayerStatus::Ready;
            session.error = None;
            session.last_nav_ms = now_ms();
        } else {
            session.status = PlayerStatus::Error;
            session.error = Some(error.unwrap_or_else(|| "open_failed".into()));
        }
        dto_of(&guard)
    };
    emit(app, &dto);
}

// ── in-app target hooks ─────────────────────────────────────────────────────
//
// The browser path has to *infer* the end of a track from periodic tab
// snapshots (see `observe_tabs`), because that is all the extension can give
// it. The in-app path gets the truth: the agent fires on the media element's
// own `ended` event. Two entry points, no heuristics, no epsilons.

/// The in-app player's current track finished on its own.
pub fn on_track_ended(app: &AppHandle) {
    let Some(handle) = app.try_state::<PlayerHandle>() else { return };
    let Some(ws) = app.try_state::<WsConnectionMap>() else { return };
    let dto = {
        let Ok(mut guard) = handle.session.lock() else { return };
        let Some(session) = guard.as_mut() else { return };
        if !session.target.is_in_app() {
            return;
        }
        let step = if session.auto_play { session.auto_step() } else { Step::Ended };
        if !apply_step(app, session, &ws, &handle, step) {
            return;
        }
        dto_of(&guard)
    };
    emit(app, &dto);
}

/// The player window could not be created. Keep the session so the UI can say
/// why, instead of the playlist silently disappearing.
pub fn on_inapp_error(app: &AppHandle, error: &str) {
    let Some(handle) = app.try_state::<PlayerHandle>() else { return };
    let dto = {
        let Ok(mut guard) = handle.session.lock() else { return };
        let Some(session) = guard.as_mut() else { return };
        if !session.target.is_in_app() {
            return;
        }
        session.status = PlayerStatus::Error;
        session.error = Some(format!("player_window_failed: {error}"));
        dto_of(&guard)
    };
    emit(app, &dto);
}

/// The player window went away — the session dies with it, exactly like the
/// browser path when the user closes the player tab.
pub fn on_inapp_closed(app: &AppHandle) {
    let Some(handle) = app.try_state::<PlayerHandle>() else { return };
    let dto = {
        let Ok(mut guard) = handle.session.lock() else { return };
        let Some(session) = guard.as_ref() else { return };
        if !session.target.is_in_app() {
            return;
        }
        *guard = None;
        dto_of(&guard)
    };
    emit(app, &dto);
}

/// Observe one browser's merged tab set after ingest. Drives player-tab
/// adoption, loss detection, and track-end auto-advance. Cheap no-op while no
/// session targets `browser_id`.
pub fn observe_tabs(
    app: &AppHandle,
    browser_id: &str,
    tabs: &[BrowserTab],
    ws: &WsConnectionMap,
) {
    let Some(handle) = app.try_state::<PlayerHandle>() else { return };
    let dto = {
        let Ok(mut guard) = handle.session.lock() else { return };
        let Some(session) = guard.as_mut() else { return };
        // In-app sessions never ride the bridge: they report through the agent
        // and end on an explicit `ended` event, so this observer ignores them.
        if session.browser_id() != Some(browser_id) {
            return;
        }
        let now = now_ms();
        let mut changed = false;

        // ── Adoption fallback: `opened` lost/skipped, find the tab by URL. ──
        if session.tab_id.is_none() {
            if let Some(track) = session.current_track() {
                if let Some(tab) = tabs
                    .iter()
                    .find(|t| crate::vault::url::normalize_url(&t.url) == track.normalized_url)
                {
                    session.tab_id = Some(tab.tab_id);
                    session.window_id = Some(tab.window_id);
                    session.status = PlayerStatus::Ready;
                    session.error = None;
                    session.pending_open_id = None;
                    changed = true;
                }
            }
            if session.tab_id.is_none() {
                // Still waiting — time the open attempt out eventually.
                if session.status == PlayerStatus::Opening
                    && now.saturating_sub(session.open_started_ms) > OPEN_TIMEOUT_MS
                {
                    session.status = PlayerStatus::Error;
                    session.error = Some("open_timeout".into());
                    changed = true;
                }
                if changed {
                    let dto = dto_of(&guard);
                    drop(guard);
                    emit(app, &dto);
                }
                return;
            }
        }

        // ── Player tab gone ⇒ the user closed it: the session dies with it. ──
        let tab_id = session.tab_id.unwrap_or_default();
        let Some(tab) = tabs.iter().find(|t| t.tab_id == tab_id) else {
            // Grace period right after open/nav: a `full` snapshot from before
            // the tab existed may still be in flight.
            if now.saturating_sub(session.last_nav_ms) < NAV_GRACE_MS {
                return;
            }
            *guard = None;
            let dto = dto_of(&guard);
            drop(guard);
            emit(app, &dto);
            return;
        };

        // ── Track identity / end detection / auto-advance. ──
        //
        // End evidence must be STRONG: sites clear/replace their media session
        // during navigation, redirects, SPA URL normalization and ad breaks.
        // A track only ends when the position observed WHILE PLAYING OUR TRACK
        // reached its duration. "Our track" is established by URL, by the
        // adopted post-redirect landing URL, or by the saved duration matching
        // the tab's media duration. And if the SITE steers the tab to another
        // video after our track finished (YouTube playlist/autoplay), PilPod
        // takes the tab back instead of following along.
        let media = tab.media.as_ref();
        let playing = media.is_some_and(|m| m.playback_state == "playing");
        let since_nav = now.saturating_sub(session.last_nav_ms);

        // Is the tab currently on OUR current track?
        let tab_norm = crate::vault::url::normalize_url(&tab.url);
        let (track_norm, expected_dur) = match session.current_track() {
            Some(t) => (t.normalized_url.clone(), t.expected_dur_secs),
            None => (String::new(), None),
        };
        let mut on_track = tab_norm == track_norm
            || session.landing_normalized.as_deref() == Some(tab_norm.as_str());
        // Secondary identity: the media duration matches the saved duration.
        if !on_track {
            if let (Some(exp), Some(m)) = (expected_dur, media) {
                if m.duration > 0.0 && (m.duration - exp).abs() <= DUR_MATCH_EPSILON_SECS {
                    on_track = true;
                }
            }
        }
        // Landing adoption: URL changes shortly after OUR nav, before anything
        // played, are the track's own redirects — rebind, don't fight them.
        // (Only after the grace window: during it the tab may still report the
        // PRE-nav URL, which must never be adopted.)
        if !on_track
            && !session.was_playing
            && session.last_seen_dur == 0.0
            && since_nav > NAV_GRACE_MS
            && since_nav <= LANDING_WINDOW_MS
        {
            session.landing_normalized = Some(tab_norm.clone());
            on_track = true;
        }

        // The track's finish line, from what we observed while it played.
        let finished_by_progress = session.last_seen_dur > 0.0
            && session.last_seen_ct >= MIN_TRACK_PLAY_SECS
            && session.last_seen_ct >= session.last_seen_dur - HIJACK_EPSILON_SECS;

        if playing && on_track {
            session.was_playing = true;
            // Record progress ONLY while playing our own track, and only when
            // the duration is plausible for it — pre-roll ads on the same URL
            // report a short duration whose "end" must not advance the list.
            if let Some(m) = media {
                if m.duration > 0.0 && duration_plausible(expected_dur, m.duration) {
                    session.last_seen_ct = m.current_time;
                    session.last_seen_dur = m.duration;
                }
            }
            if session.status == PlayerStatus::Ended {
                // User pressed play again in the tab after the list ended.
                session.status = PlayerStatus::Ready;
                changed = true;
            }
        } else if !on_track && since_nav > NAV_GRACE_MS && finished_by_progress {
            // SITE HIJACK: our track finished and the site steered the tab to
            // its own next video. Take the tab back — navigate to OUR next
            // track (repeat mode respected); with auto-play off, just end.
            session.was_playing = false;
            let step = if session.auto_play { session.auto_step() } else { Step::Ended };
            changed |= apply_step(app, session, ws, &handle, step);
        } else if !playing && on_track && session.was_playing && since_nav > NAV_GRACE_MS {
            // Natural end on our own URL: live paused-at-the-end reading (if
            // its duration is plausibly the track's, not an ad's), else the
            // last playing reading (absent media ⇒ unload, not evidence).
            let (ct, dur) = match media {
                Some(m) if m.duration > 0.0 && duration_plausible(expected_dur, m.duration) => {
                    (m.current_time, m.duration)
                }
                _ => (session.last_seen_ct, session.last_seen_dur),
            };
            let ended = dur > 0.0
                && ct >= MIN_TRACK_PLAY_SECS
                && ct >= dur - END_EPSILON_SECS;
            session.was_playing = false;
            if ended {
                let step = if session.auto_play { session.auto_step() } else { Step::Ended };
                changed |= apply_step(app, session, ws, &handle, step);
            }
            // Not ended ⇒ plain user pause; nothing to emit.
        }
        // Playing but !on_track without finish evidence ⇒ the user (or an ad
        // break) took the tab somewhere mid-track — leave it alone.

        if !changed {
            return;
        }
        dto_of(&guard)
    };
    emit(app, &dto);
}
