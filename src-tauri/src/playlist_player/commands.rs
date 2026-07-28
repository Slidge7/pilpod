//! Tauri commands for the playlist player. Thin shells: lock → mutate via
//! `state.rs` transitions → release → emit. Vault access is read-only
//! (snapshot), browser access goes through the bridge's public push helpers.

use tauri::{AppHandle, State};

use crate::browser_bridge::protocol::frames::ServerMsg;
use crate::browser_bridge::{push_ws_frame, ws_supports_nav, WsConnectionMap};
use crate::browser_tabs::{enqueue_browser_command, BrowserCommandsQueue};
use crate::vault::state::VaultStateHandle;

use super::dto::PlayerStateDto;
use super::state::{PlaybackTarget, PlayerSession, PlayerStatus, PlayerTrack, RepeatMode, Step};
use super::{now_ms, PlayerHandle};

/// Typed error codes surfaced to the UI (mirrored in the TS hook).
pub const ERR_PLAYLIST_NOT_FOUND: &str = "playlist_not_found";
pub const ERR_PLAYLIST_EMPTY: &str = "playlist_empty";
pub const ERR_BROWSER_NOT_CONNECTED: &str = "browser_not_connected";
pub const ERR_NAV_UNSUPPORTED: &str = "companion_nav_unsupported";
pub const ERR_NO_SESSION: &str = "no_session";
pub const ERR_POISONED: &str = "state_poisoned";
pub const ERR_NO_BROWSER_PICKED: &str = "no_browser_picked";

/// Resolve the requested playback target. Absent/unknown ⇒ browser (the
/// original behaviour), so old callers keep working unchanged.
fn resolve_target(target: Option<&str>, browser_id: Option<String>) -> Result<PlaybackTarget, String> {
    match target.map(str::trim) {
        Some("inApp") | Some("inapp") | Some("app") => Ok(PlaybackTarget::InApp),
        _ => browser_id
            .filter(|b| !b.trim().is_empty())
            .map(PlaybackTarget::Browser)
            .ok_or_else(|| ERR_NO_BROWSER_PICKED.to_string()),
    }
}

#[cfg(test)]
mod target_tests {
    use super::*;

    #[test]
    fn in_app_needs_no_browser() {
        assert_eq!(resolve_target(Some("inApp"), None), Ok(PlaybackTarget::InApp));
        assert_eq!(resolve_target(Some(" inapp "), None), Ok(PlaybackTarget::InApp));
    }

    #[test]
    fn browser_target_requires_a_browser_id() {
        assert_eq!(
            resolve_target(Some("browser"), Some("b_1".into())),
            Ok(PlaybackTarget::Browser("b_1".into()))
        );
        assert_eq!(
            resolve_target(Some("browser"), Some("  ".into())),
            Err(ERR_NO_BROWSER_PICKED.to_string())
        );
        assert_eq!(
            resolve_target(Some("browser"), None),
            Err(ERR_NO_BROWSER_PICKED.to_string())
        );
    }

    #[test]
    fn absent_target_keeps_the_original_browser_behaviour() {
        assert_eq!(
            resolve_target(None, Some("b_2".into())),
            Ok(PlaybackTarget::Browser("b_2".into()))
        );
    }
}

fn emit_current(app: &AppHandle, player: &super::PlayerState) {
    let dto = player
        .session
        .lock()
        .ok()
        .map(|g| super::dto_of(&g))
        .unwrap_or_else(PlayerStateDto::idle);
    super::emit(app, &dto);
}

#[tauri::command]
pub fn player_get_state(player: State<'_, PlayerHandle>) -> PlayerStateDto {
    player
        .session
        .lock()
        .ok()
        .map(|g| super::dto_of(&g))
        .unwrap_or_else(PlayerStateDto::idle)
}

/// Start playing `playlist_id` on the chosen target: a new player tab in
/// `browser_id`, or PilPod's own webview window (`target: "inApp"`).
/// Replaces any existing session (the old player tab is left alone unless
/// `player_stop { closeTab:true }` was called first; an old *in-app* window is
/// always reclaimed, since PilPod owns it).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn player_start(
    app: AppHandle,
    player: State<'_, PlayerHandle>,
    vault: State<'_, VaultStateHandle>,
    ws: State<'_, WsConnectionMap>,
    playlist_id: String,
    target: Option<String>,
    browser_id: Option<String>,
    shuffle: Option<bool>,
    repeat: Option<String>,
    auto_play: Option<bool>,
) -> Result<(), String> {
    let target = resolve_target(target.as_deref(), browser_id)?;

    if let PlaybackTarget::Browser(browser_id) = &target {
        if !ws_supports_nav(&ws, browser_id) {
            // Distinguish "socket down" from "old companion" for a precise UI hint.
            let connected = crate::browser_bridge::connections::ws_connected_ids(&ws)
                .contains(browser_id);
            return Err(if connected {
                ERR_NAV_UNSUPPORTED.into()
            } else {
                ERR_BROWSER_NOT_CONNECTED.into()
            });
        }
    }

    // Resolve the playlist snapshot → tracks (read-only vault access).
    let data = vault.snapshot();
    let playlist = data
        .playlists
        .iter()
        .find(|p| p.id == playlist_id)
        .ok_or(ERR_PLAYLIST_NOT_FOUND)?;
    let tracks: Vec<PlayerTrack> = playlist
        .item_ids
        .iter()
        .filter_map(|id| data.media_items.iter().find(|m| &m.id == id))
        .filter(|m| m.url.starts_with("https://") || m.url.starts_with("http://"))
        .map(|m| {
            // Strip site-playlist context (YouTube `list`/`index`/radio) so the
            // tab plays ONE item — PilPod owns sequencing, not the site.
            let url = super::track_url::sanitize_track_url(&m.url);
            PlayerTrack {
                item_id: m.id.clone(),
                normalized_url: crate::vault::url::normalize_url(&url),
                url,
                expected_dur_secs: m.duration_secs,
            }
        })
        .collect();
    if tracks.is_empty() {
        return Err(ERR_PLAYLIST_EMPTY.into());
    }

    let now = now_ms();
    let mut session = PlayerSession::new(
        playlist_id,
        target,
        tracks,
        shuffle.unwrap_or(false),
        repeat.as_deref().and_then(RepeatMode::parse).unwrap_or(RepeatMode::Off),
        auto_play.unwrap_or(true),
        now,
        now ^ (now << 21),
    );

    let first_url = session
        .current_track()
        .map(|t| t.url.clone())
        .ok_or(ERR_PLAYLIST_EMPTY)?;

    // The webview belongs to PilPod: reclaim it whenever the new session is not
    // going to reuse it.
    let previous_was_in_app = player
        .session
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.target.is_in_app()))
        .unwrap_or(false);

    match session.target.browser_id().map(str::to_owned) {
        None => {
            // In-app: no handshake to wait for — PilPod creates the surface
            // itself, so the session is Ready the moment it starts.
            session.tab_id = Some(crate::inapp_player::INAPP_TAB_ID);
            session.window_id = Some(crate::inapp_player::INAPP_WINDOW_ID);
            session.status = PlayerStatus::Ready;
            crate::inapp_player::open(&app, &first_url);
        }
        Some(browser_id) => {
            if previous_was_in_app {
                crate::inapp_player::stop(&app);
            }
            // Open the player tab in a fresh browser window.
            let open_id = player.next_id("o");
            let frame = ServerMsg::Open {
                id: open_id.clone(),
                url: first_url,
                new_window: true,
            };
            if !push_ws_frame(&ws, &browser_id, &frame) {
                return Err(ERR_BROWSER_NOT_CONNECTED.into());
            }
            session.pending_open_id = Some(open_id);
        }
    }

    {
        let mut guard = player.session.lock().map_err(|_| ERR_POISONED)?;
        *guard = Some(session);
    }
    emit_current(&app, &player);
    Ok(())
}

/// Stop the session. `close_tab` also closes the player tab in the browser.
#[tauri::command]
pub fn player_stop(
    app: AppHandle,
    player: State<'_, PlayerHandle>,
    ws: State<'_, WsConnectionMap>,
    queue: State<'_, BrowserCommandsQueue>,
    close_tab: bool,
) -> Result<(), String> {
    let stopped = {
        let mut guard = player.session.lock().map_err(|_| ERR_POISONED)?;
        guard.take()
    };
    match stopped {
        // The in-app window IS the player: stopping always tears it down, so
        // no stray webview (and no stray RAM) outlives the session.
        Some(s) if s.target.is_in_app() => crate::inapp_player::stop(&app),
        Some(s) if close_tab => {
            if let (Some(browser_id), Some(tab_id)) = (s.browser_id(), s.tab_id) {
                enqueue_browser_command(
                    &queue,
                    Some(&ws),
                    browser_id,
                    tab_id as i32,
                    "closeTab",
                    None,
                );
            }
        }
        _ => {}
    }
    emit_current(&app, &player);
    Ok(())
}

fn skip(
    app: &AppHandle,
    player: &State<'_, PlayerHandle>,
    ws: &WsConnectionMap,
    forward: bool,
) -> Result<(), String> {
    {
        let mut guard = player.session.lock().map_err(|_| ERR_POISONED)?;
        let session = guard.as_mut().ok_or(ERR_NO_SESSION)?;
        let step = if forward { session.next_step() } else { session.prev_step() };
        // A manual skip out of "ended" resumes the session.
        if session.status == PlayerStatus::Ended && matches!(step, Step::To(_) | Step::Restart) {
            session.status = PlayerStatus::Ready;
        }
        super::apply_step(app, session, ws, player, step);
    }
    emit_current(app, player);
    Ok(())
}

#[tauri::command]
pub fn player_next(
    app: AppHandle,
    player: State<'_, PlayerHandle>,
    ws: State<'_, WsConnectionMap>,
) -> Result<(), String> {
    skip(&app, &player, &ws, true)
}

#[tauri::command]
pub fn player_prev(
    app: AppHandle,
    player: State<'_, PlayerHandle>,
    ws: State<'_, WsConnectionMap>,
) -> Result<(), String> {
    skip(&app, &player, &ws, false)
}

/// Jump straight to a playlist item (row click in the playlist page).
#[tauri::command]
pub fn player_play_item(
    app: AppHandle,
    player: State<'_, PlayerHandle>,
    ws: State<'_, WsConnectionMap>,
    item_id: String,
) -> Result<(), String> {
    {
        let mut guard = player.session.lock().map_err(|_| ERR_POISONED)?;
        let session = guard.as_mut().ok_or(ERR_NO_SESSION)?;
        let pos = session.pos_of_item(&item_id).ok_or("item_not_in_playlist")?;
        if session.status == PlayerStatus::Ended {
            session.status = PlayerStatus::Ready;
        }
        super::navigate(&app, session, &ws, player.inner(), pos);
    }
    emit_current(&app, &player);
    Ok(())
}

/// Update repeat / shuffle / auto-play. Absent fields stay unchanged.
#[tauri::command]
pub fn player_set_modes(
    app: AppHandle,
    player: State<'_, PlayerHandle>,
    repeat: Option<String>,
    shuffle: Option<bool>,
    auto_play: Option<bool>,
) -> Result<(), String> {
    {
        let mut guard = player.session.lock().map_err(|_| ERR_POISONED)?;
        let session = guard.as_mut().ok_or(ERR_NO_SESSION)?;
        if let Some(r) = repeat.as_deref().and_then(RepeatMode::parse) {
            session.repeat = r;
            // Repeat can revive an "ended" session's forward path.
            if session.status == PlayerStatus::Ended && r != RepeatMode::Off {
                session.status = PlayerStatus::Ready;
            }
        }
        if let Some(s) = shuffle {
            let now = now_ms();
            session.set_shuffle(s, now ^ (now >> 3) | 1);
        }
        if let Some(a) = auto_play {
            session.auto_play = a;
        }
    }
    emit_current(&app, &player);
    Ok(())
}
