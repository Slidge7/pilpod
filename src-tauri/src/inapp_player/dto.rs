//! Compact media snapshot for the player window's own UI.
//!
//! The dashboard consumes the in-app player through `browsers://update` like
//! any browser tab (see `state::to_detected_browser`). The player window needs
//! the same facts many times per second, so it gets this much smaller payload
//! on `inapp://media` instead of re-serialising every browser and tab.
//!
//! Mirrored by hand in `src/features/player-window/types.ts`.

use serde::{Deserialize, Serialize};

use super::state::InAppSession;

/// What PilPod's own stage page should render.
///
/// `kind` is `"youtube"` when a video id is present (the IFrame API path) and
/// `"idle"` otherwise — a site's page is not rendered by the stage page at all,
/// it *is* the stage webview's document.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageDto {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_id: Option<String>,
    /// Volume to apply on load, so a track never starts louder than the last.
    pub volume: f64,
}

impl StageDto {
    pub fn idle() -> Self {
        Self {
            kind: "idle".into(),
            video_id: None,
            volume: 100.0,
        }
    }

    pub fn from_session(s: &InAppSession) -> Self {
        match &s.video_id {
            Some(id) => Self {
                kind: "youtube".into(),
                video_id: Some(id.clone()),
                volume: s.tab_volume,
            },
            None => Self::idle(),
        }
    }
}

/// One playback command for the stage page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageCommand {
    pub action: String,
    pub value: Option<f64>,
}

/// A media snapshot reported by PilPod's own stage page. Same facts the
/// injected agent reports for a site's page, over IPC instead of the
/// navigation channel.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageReport {
    #[serde(default)]
    pub playback_state: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub artwork_url: String,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub current_time: f64,
    #[serde(default)]
    pub volume: f64,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub has_media: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InAppMediaDto {
    /// False ⇒ no player session at all.
    pub active: bool,
    /// True while the page is loading and no media element has been found yet —
    /// what the UI shows a spinner for.
    pub loading: bool,
    pub url: String,
    pub title: String,
    pub artist: String,
    pub artwork_url: String,
    /// `"playing" | "paused" | "none"`
    pub playback_state: String,
    pub duration: f64,
    pub current_time: f64,
    /// Percentage, same units as the extension (100 = native).
    pub volume: f64,
    pub muted: bool,
    pub can_seek: bool,
}

impl InAppMediaDto {
    pub fn idle() -> Self {
        Self {
            active: false,
            loading: false,
            url: String::new(),
            title: String::new(),
            artist: String::new(),
            artwork_url: String::new(),
            playback_state: "none".into(),
            duration: 0.0,
            current_time: 0.0,
            volume: 100.0,
            muted: false,
            can_seek: false,
        }
    }

    pub fn from_session(s: &InAppSession) -> Self {
        Self {
            active: true,
            loading: !s.has_media,
            url: s.url.clone(),
            title: if s.media_title.is_empty() {
                s.page_title.clone()
            } else {
                s.media_title.clone()
            },
            artist: s.artist.clone(),
            artwork_url: s.artwork_url.clone(),
            playback_state: s.playback_state.clone(),
            duration: s.duration,
            current_time: s.current_time,
            volume: s.tab_volume,
            muted: s.tab_muted,
            can_seek: s.can_seek,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loading_until_media_is_found() {
        let mut s = InAppSession::opening("https://x.test/a");
        s.page_title = "Loading page".into();
        let dto = InAppMediaDto::from_session(&s);
        assert!(dto.active && dto.loading);
        // Falls back to the page title until the media reports its own.
        assert_eq!(dto.title, "Loading page");

        s.has_media = true;
        s.media_title = "Track".into();
        let dto = InAppMediaDto::from_session(&s);
        assert!(!dto.loading);
        assert_eq!(dto.title, "Track");
    }

    #[test]
    fn idle_is_inactive() {
        let dto = InAppMediaDto::idle();
        assert!(!dto.active && !dto.loading);
        assert_eq!(dto.volume, 100.0);
    }
}
