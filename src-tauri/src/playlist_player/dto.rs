//! Frontend-facing DTO for `player://update` and `player_get_state`.
//! Mirrored by hand in `src/features/playlist-player/types.ts` — keep in sync.

use serde::Serialize;

use super::state::PlayerSession;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStateDto {
    /// False ⇒ no session; every optional field is absent.
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_id: Option<i64>,
    /// `"idle" | "opening" | "ready" | "ended" | "error"`.
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_item_id: Option<String>,
    /// 1-based position in the play order (0 when inactive/empty).
    pub track_number: u32,
    pub total_tracks: u32,
    /// `"off" | "one" | "all"`.
    pub repeat: String,
    pub shuffle: bool,
    pub auto_play: bool,
}

impl PlayerStateDto {
    pub fn idle() -> Self {
        Self {
            active: false,
            playlist_id: None,
            browser_id: None,
            tab_id: None,
            window_id: None,
            status: "idle".into(),
            error: None,
            current_item_id: None,
            track_number: 0,
            total_tracks: 0,
            repeat: "off".into(),
            shuffle: false,
            auto_play: true,
        }
    }

    pub fn from_session(s: &PlayerSession) -> Self {
        Self {
            active: true,
            playlist_id: Some(s.playlist_id.clone()),
            browser_id: Some(s.browser_id.clone()),
            tab_id: s.tab_id,
            window_id: s.window_id,
            status: s.status.as_str().into(),
            error: s.error.clone(),
            current_item_id: s.current_track().map(|t| t.item_id.clone()),
            track_number: (s.pos + 1) as u32,
            total_tracks: s.tracks.len() as u32,
            repeat: s.repeat.as_str().into(),
            shuffle: s.shuffle,
            auto_play: s.auto_play,
        }
    }
}
