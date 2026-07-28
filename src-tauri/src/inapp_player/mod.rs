//! In-app playlist playback — plays a vault playlist inside PilPod's own OS
//! webview instead of a connected browser tab.
//!
//! The agent injected into that webview (see `agent/agent.js`) plays the role
//! the companion extension's content script plays in a real browser: it reports
//! media state in the **same shape** (`BrowserTab` / `TabMedia`) and executes
//! the **same `action` enum**. Consequently the entire existing control surface
//! — media cards, seek bar, volume, the playlist card — drives the in-app
//! player without knowing it exists, and `PROTOCOL.md` and the companion
//! extension are untouched.
//!
//! This module is a *sibling* of the browser bridge, never a layer on top of
//! it. It exposes three things to the rest of the app:
//!
//!   * [`detected_browser_row`] — the player as a one-tab browser row, appended
//!     in `browser_detector::build_browsers_payload`.
//!   * [`send_command`] — the `action` enum, routed from
//!     `browser_bridge::command::browser_media_control`.
//!   * [`open`] / [`navigate`] / [`stop`] — track transport, driven by
//!     `playlist_player` when the session's target is `InApp`.
//!
//! State lives in a module-global (set once in `init`) rather than Tauri's
//! managed state: the payload seam in `build_browsers_payload` has no
//! `AppHandle`, and threading a parameter through its callers would smear this
//! feature across files that have no business knowing about it. Same pattern as
//! `browser_icon::init` / `browser_profile_order::init`.

pub mod agent;
pub mod bridge;
pub mod commands;
pub mod dto;
pub mod state;
pub mod window;

use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::browser_dto::DetectedBrowser;
use crate::playlist_player::track_url::StagePlan;
use bridge::Report;
use dto::{InAppMediaDto, StageDto, StageReport};

/// Compact media snapshot for the player window's own UI.
pub const EVT_MEDIA: &str = "inapp://media";
/// What the stage should be showing (PilPod's own stage page listens).
pub const EVT_STAGE: &str = "inapp://stage";
/// A playback command for PilPod's own stage page.
pub const EVT_CMD: &str = "inapp://cmd";

pub use state::{InAppSession, INAPP_BROWSER_ID, INAPP_TAB_ID, INAPP_WINDOW_ID};

/// Progress-only reports repaint the dashboard at most this often (same budget
/// as the WS bridge's `PROG_EMIT_THROTTLE`). State changes bypass it.
const PROG_EMIT_THROTTLE: Duration = Duration::from_millis(250);

struct Inner {
    session: Option<InAppSession>,
    last_emit: Instant,
}

pub struct InAppState {
    inner: Mutex<Inner>,
}

type Handle = Arc<InAppState>;

static STATE: OnceLock<Handle> = OnceLock::new();

/// Register the module. Called once from `app/setup.rs`.
pub fn init() {
    let _ = STATE.set(Arc::new(InAppState {
        inner: Mutex::new(Inner {
            session: None,
            last_emit: Instant::now() - PROG_EMIT_THROTTLE,
        }),
    }));
}

fn handle() -> Option<&'static Handle> {
    STATE.get()
}

/// True while a player session exists. Cheap: one lock, no allocation.
pub fn is_active() -> bool {
    handle()
        .and_then(|h| h.inner.lock().ok().map(|g| g.session.is_some()))
        .unwrap_or(false)
}

/// The player as a one-tab "browser" row for `browsers://update`.
/// `None` ⇒ nothing to add, the dashboard is unchanged.
pub fn detected_browser_row() -> Option<DetectedBrowser> {
    let guard = handle()?.inner.lock().ok()?;
    guard.session.as_ref().map(InAppSession::to_detected_browser)
}

/// Current media snapshot for the player window (and its hydration command).
pub fn media_snapshot() -> InAppMediaDto {
    handle()
        .and_then(|h| h.inner.lock().ok())
        .and_then(|g| g.session.as_ref().map(InAppMediaDto::from_session))
        .unwrap_or_else(InAppMediaDto::idle)
}

fn emit_media(app: &AppHandle) {
    if let Err(e) = app.emit(EVT_MEDIA, media_snapshot()) {
        eprintln!("[inapp] emit media failed: {e}");
    }
}

/// What PilPod's own stage page should render right now.
pub fn stage_snapshot() -> StageDto {
    handle()
        .and_then(|h| h.inner.lock().ok())
        .and_then(|g| g.session.as_ref().map(StageDto::from_session))
        .unwrap_or_else(StageDto::idle)
}

fn emit_stage(app: &AppHandle) {
    if let Err(e) = app.emit(EVT_STAGE, stage_snapshot()) {
        eprintln!("[inapp] emit stage failed: {e}");
    }
}

/// Fold a report from PilPod's own stage page (the YouTube IFrame API path).
/// Same destination as the injected agent's reports — different transport.
pub fn on_stage_report(app: &AppHandle, report: StageReport) {
    let Some(h) = handle() else { return };
    let (changed, audio_fix) = {
        let Ok(mut guard) = h.inner.lock() else { return };
        let g: &mut Inner = &mut guard;
        let Some(session) = g.session.as_mut() else { return };
        let before = session.state_sig();
        session.apply_stage(&report);
        let fix = session.take_audio_fix();
        let changed = before != session.state_sig();
        if changed || g.last_emit.elapsed() >= PROG_EMIT_THROTTLE {
            g.last_emit = Instant::now();
            (true, fix)
        } else {
            (false, fix)
        }
    };

    if let Some((volume, muted)) = audio_fix {
        send_command(app, "setTabVolume", Some(volume));
        send_command(app, "muteTab", Some(if muted { 1.0 } else { 0.0 }));
    }

    emit_media(app);
    if changed {
        emit_browsers(app);
    }
}

/// The stage page's track finished — same handling as the agent's `ended`.
pub fn on_stage_ended(app: &AppHandle) {
    crate::playlist_player::on_track_ended(app);
}

// ── transport (driven by `playlist_player`) ─────────────────────────────────

/// Resolve how a track should be staged, and what the session should record.
fn plan(url: &str) -> (window::StageTarget, Option<String>, String) {
    match crate::playlist_player::track_url::stage_plan(url) {
        StagePlan::Youtube { video_id } => {
            (window::StageTarget::Local, Some(video_id), url.to_string())
        }
        StagePlan::Page { url: page } => match page.parse::<tauri::Url>() {
            Ok(parsed) => (window::StageTarget::Remote(parsed), None, page),
            // Unparsable URLs still get a session, so the UI can say so rather
            // than spinning; the stage simply stays where it is.
            Err(_) => (window::StageTarget::Local, None, page),
        },
    }
}

/// Start a session on `url`, creating the player window.
pub fn open(app: &AppHandle, url: &str) {
    let (target, video_id, staged) = plan(url);
    if let Some(h) = handle() {
        if let Ok(mut g) = h.inner.lock() {
            let mut session = InAppSession::opening_staged(url, &staged);
            session.video_id = video_id;
            g.session = Some(session);
        }
    }
    window::open_or_navigate(app, target);
    emit_browsers(app);
    emit_media(app);
    emit_stage(app);
}

/// Move the existing session to `url` (next/prev/jump). Resets per-track state
/// so a stale duration can never be mistaken for the new track's — but carries
/// the user's volume/mute across the change.
pub fn navigate(app: &AppHandle, url: &str) {
    let (target, video_id, staged) = plan(url);
    if let Some(h) = handle() {
        if let Ok(mut g) = h.inner.lock() {
            let mut next = InAppSession::next_track(url, &staged, g.session.as_ref());
            next.video_id = video_id;
            g.session = Some(next);
        }
    }
    window::open_or_navigate(app, target);
    emit_browsers(app);
    emit_media(app);
    emit_stage(app);
}

/// End the session and destroy the window.
pub fn stop(app: &AppHandle) {
    let existed = clear_session();
    window::close(app);
    if existed {
        emit_browsers(app);
        emit_media(app);
    }
}

pub fn focus(app: &AppHandle) {
    window::focus(app);
}

fn clear_session() -> bool {
    let Some(h) = handle() else { return false };
    let Ok(mut g) = h.inner.lock() else { return false };
    g.session.take().is_some()
}

/// The player window went away (user closed it, or creation failed). The
/// playlist session dies with it — same rule as the browser path's "player tab
/// closed".
pub fn on_window_gone(app: &AppHandle) {
    // Deliberately noisy: "the window vanished" is the one failure mode with no
    // other trace, and this line separates "never built" from "built, then
    // destroyed".
    eprintln!("[inapp] player window destroyed");
    if clear_session() {
        emit_browsers(app);
        emit_media(app);
    }
    crate::playlist_player::on_inapp_closed(app);
}

/// The window could not be created at all. Unlike a user-closed window this
/// keeps the playlist session alive and flips it to Error, so the reason lands
/// in the UI instead of the surface just disappearing.
pub fn on_window_failed(app: &AppHandle, error: &str) {
    if clear_session() {
        emit_browsers(app);
        emit_media(app);
    }
    crate::playlist_player::on_inapp_error(app, error);
}

// ── commands (routed from `browser_media_control`) ──────────────────────────

/// Execute one shared `action` in the player. Returns false when there is no
/// player to act on, so the caller can report a precise error.
pub fn send_command(app: &AppHandle, action: &str, value: Option<f64>) -> bool {
    match action {
        // Lifecycle actions are ours, not the page's.
        "closeTab" => {
            stop(app);
            true
        }
        "focusTab" | "focusWindow" | "reactivateTab" => {
            if !window::exists(app) {
                return false;
            }
            focus(app);
            true
        }
        // Sequencing always belongs to PilPod, never to the page.
        "next" | "previous" => false,
        // PilPod's own stage page takes commands as events (it owns a real
        // player API); a site's page takes them as an injected call.
        _ if stage_is_local() => {
            let payload = dto::StageCommand {
                action: action.to_string(),
                value,
            };
            app.emit(EVT_CMD, payload).is_ok()
        }
        _ => window::eval(app, agent::command_js(action, value)),
    }
}

/// True when the stage is showing PilPod's own page rather than a site's.
fn stage_is_local() -> bool {
    handle()
        .and_then(|h| h.inner.lock().ok())
        .map(|g| g.session.as_ref().is_some_and(|s| s.video_id.is_some()))
        .unwrap_or(false)
}

// ── reports (from the injected agent) ──────────────────────────────────────

/// Fold one agent message into the session. Called from `bridge::intercept` on
/// the webview thread — must stay allocation-light and never block.
pub fn on_report(app: &AppHandle, raw: &str) {
    let Some(report) = bridge::parse(raw) else { return };

    match report {
        // Legacy: the agent used to draw its own drag strip. Window chrome now
        // lives in the `player-ui` webview, which drags the window through
        // Tauri's own API — so this is accepted and ignored rather than
        // failing on a stale player page that is still running the old agent.
        Report::Drag => return,
        Report::Close => {
            // Destroying the window fires `Destroyed` → `on_window_gone`, which
            // is the single place a session ends.
            window::close(app);
            return;
        }
        Report::Ended => {
            crate::playlist_player::on_track_ended(app);
            return;
        }
        // The stage loaded but never produced a media element. On YouTube that
        // means the video refuses to be embedded — fall back to its real page
        // once, where the generic cinema layout takes over.
        Report::Notice(ref reason) if reason == "no_media" => {
            let fallback = handle().and_then(|h| {
                let mut g = h.inner.lock().ok()?;
                let s = g.session.as_mut()?;
                if s.fell_back || s.original_url.is_empty() || s.original_url == s.url {
                    return None;
                }
                s.fell_back = true;
                let url = s.original_url.clone();
                s.url = url.clone();
                Some(url)
            });
            if let Some(url) = fallback {
                if let Ok(parsed) = url.parse::<tauri::Url>() {
                    eprintln!("[inapp] stage produced no media; falling back to the page");
                    window::open_or_navigate(app, window::StageTarget::Remote(parsed));
                }
            }
            return;
        }
        Report::Notice(_) => return,
        Report::State(_) | Report::Progress { .. } => {}
    }

    let Some(h) = handle() else { return };
    let mut audio_fix = None;
    let should_emit = {
        let Ok(mut guard) = h.inner.lock() else { return };
        // One deref of the guard, then disjoint field borrows off it: `session`
        // and `last_emit` are both touched below.
        let g: &mut Inner = &mut guard;
        // A report with no session means the window outlived its playlist —
        // ignore it rather than resurrecting a dead session.
        let Some(session) = g.session.as_mut() else { return };

        let immediate = match report {
            Report::State(st) => {
                let st = *st;
                let before = session.state_sig();
                session.url = st.url;
                session.page_title = st.page_title;
                session.playback_state = st.playback_state;
                session.media_title = st.media_title;
                session.artist = st.artist;
                session.album = st.album;
                session.artwork_url = st.artwork_url;
                session.duration = st.duration;
                session.current_time = st.current_time;
                session.tab_volume = st.volume_pct;
                session.tab_muted = st.muted;
                session.can_seek = st.can_seek;
                session.can_pip = st.can_pip;
                session.in_pip = st.in_pip;
                session.has_media = st.has_media;
                audio_fix = session.take_audio_fix();
                before != session.state_sig()
            }
            Report::Progress { current_time, duration, playing } => {
                session.current_time = current_time;
                if duration > 0.0 {
                    session.duration = duration;
                    // A known duration IS seekability. Without this the bar
                    // stayed disabled forever whenever the first state report
                    // landed before the media knew how long it was — which is
                    // the normal case on streaming sites.
                    session.can_seek = true;
                }
                let want = if playing { "playing" } else { "paused" };
                let flipped = session.playback_state != want;
                session.playback_state = want.into();
                session.has_media = true;
                flipped
            }
            _ => false,
        };

        if immediate {
            g.last_emit = Instant::now();
            true
        } else if g.last_emit.elapsed() >= PROG_EMIT_THROTTLE {
            g.last_emit = Instant::now();
            true
        } else {
            false
        }
    };

    // Restore the user's volume on a freshly loaded track (outside the lock).
    if let Some((volume, muted)) = audio_fix {
        send_command(app, "setTabVolume", Some(volume));
        send_command(app, "muteTab", Some(if muted { 1.0 } else { 0.0 }));
    }

    // The player window's own UI is tiny to serialise, so it always gets the
    // update; the dashboard payload (every browser, every tab) stays throttled.
    emit_media(app);
    if should_emit {
        emit_browsers(app);
    }
}

/// Re-emit `browsers://update` so the dashboard picks the player row up. Uses
/// the detector's own builder, so the in-app row and the real browsers always
/// travel together in one payload.
fn emit_browsers(app: &AppHandle) {
    use crate::browser_detector::{
        DetectedBrowsersState, ExtensionInstalledState, ReconnectingBrowsersState,
    };
    let (Some(detected), Some(slots), Some(ext), Some(reconnecting), Some(ws)) = (
        app.try_state::<DetectedBrowsersState>(),
        app.try_state::<crate::browser_tabs::BrowserSlotsMap>(),
        app.try_state::<ExtensionInstalledState>(),
        app.try_state::<ReconnectingBrowsersState>(),
        app.try_state::<crate::browser_bridge::WsConnectionMap>(),
    ) else {
        return;
    };
    crate::browser_detector::emit_browsers_to_ui(
        app,
        &detected,
        &slots,
        &ext,
        &reconnecting,
        &ws,
    );
}
