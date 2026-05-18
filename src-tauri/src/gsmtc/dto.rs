use std::collections::HashMap;

use serde::{Deserialize, Serialize};

pub const SNAPSHOT_VERSION: u32 = 9;

// ── OS / extension browser types ────────────────────────────────────────────

/// Internal-only: result of the OS browser scan.  Not serialised to the frontend directly.
#[derive(Debug, Clone, PartialEq)]
pub struct DetectedBrowserInfo {
    /// Stable lower-case key: "chrome", "msedge", "firefox", "brave", etc.
    pub id: String,
    /// Human-readable display name: "Google Chrome", etc.
    pub display_name: String,
    /// True when the browser process was seen in the current OS scan.
    pub running: bool,
}

/// Emitted on `"browsers://update"` — one entry per detected or active browser.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedBrowser {
    /// Stable id: "chrome", "msedge", "firefox", "brave", etc.
    /// For browsers seen only via extension (not in the OS scan), this is the
    /// `browserId` UUID sent by the extension.
    pub id: String,
    pub display_name: String,
    /// True when the browser process is currently running (from OS scan).
    pub running: bool,
    /// True when the extension has ever successfully connected to PilPod for
    /// this browser.  Persisted across app restarts; does NOT flip off just
    /// because a heartbeat was missed.
    pub extension_installed: bool,
    /// True when the extension sent a POST within the last 3 seconds.
    /// Separate from `extension_installed` so the UI can distinguish
    /// "installed but currently disconnected" from "never installed".
    pub extension_connected: bool,
    pub tab_count: u32,
    pub tabs: Vec<BrowserTab>,
    /// Seconds elapsed since the last successful POST from this browser's extension.
    /// `None` if no POST has ever been received for this browser in the current session.
    /// Used by the UI to display "Offline · cached 2 min ago" hints.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_secs: Option<u64>,
}

/// Unified tab representation — replaces the old `BrowserTabMediaDto` + `TabMeta` split.
/// Every tab is reported, with an optional `media` field when content is playing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTab {
    pub tab_id: i64,
    pub window_id: i64,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
    /// Extension sends `favIconUrl`; accept both spellings when deserializing.
    #[serde(default, alias = "favIconUrl")]
    pub favicon_url: String,
    /// "active" | "inactive" | "loading" | "sleeping" | "crashed" | "unknown"
    #[serde(default)]
    pub tab_state: String,
    /// True when this is the selected tab in its window.
    #[serde(default)]
    pub active: bool,
    /// True when the tab's window is the currently focused browser window.
    #[serde(default)]
    pub window_focused: bool,
    #[serde(default)]
    pub audible: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub index: u32,
    /// Present when the content script detected media; absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<TabMedia>,
    /// Filled server-side — identifies which browser this tab belongs to.
    #[serde(default)]
    pub browser_id: String,
}

/// Media details reported by the content script for a tab that has an active media element
/// or a MediaSession with metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabMedia {
    /// "playing" | "paused" | "none"
    #[serde(default)]
    pub playback_state: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub album: String,
    /// Best-effort cover image from MediaSession artwork or video poster.
    #[serde(default)]
    pub artwork_url: String,
    /// Track length in seconds (0 if unknown).
    #[serde(default)]
    pub duration: f64,
    /// Playback position in seconds (0 if unknown).
    #[serde(default)]
    pub current_time: f64,
    /// `document.visibilityState === "visible"` from content script.
    #[serde(default)]
    pub page_visible: bool,
    /// Milliseconds since last user interaction on page.
    #[serde(default)]
    pub user_idle_ms: u64,
    /// document.readyState: "loading" | "interactive" | "complete"
    #[serde(default)]
    pub document_state: String,
}

// ── WASAPI / GSMTC audio types ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSessionInfoDto {
    pub instance_id: String,
    pub volume: f32,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineDto {
    pub start_ticks: i64,
    pub end_ticks: i64,
    pub position_ticks: i64,
    pub min_seek_ticks: i64,
    pub max_seek_ticks: i64,
    pub last_updated_unix_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlsDto {
    pub play_pause_toggle_enabled: bool,
    pub next_enabled: bool,
    pub previous_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSessionDto {
    /// Index in `GlobalSystemMediaTransportControlsSessionManager::GetSessions()` order.
    pub session_index: u32,
    pub source_app_user_model_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub subtitle: String,
    pub playback_status: String,
    pub playback_type: Option<String>,
    pub timeline: TimelineDto,
    pub controls: ControlsDto,
    pub thumbnail_mime: Option<String>,
    pub thumbnail_base64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<AudioSessionInfoDto>,
}

// ── GSMTC snapshot (Windows media sessions only) ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GsmtcSnapshot {
    pub version: u32,
    pub sessions: Vec<MediaSessionDto>,
    /// Per-browser audio volume from WASAPI, keyed by the extension's `browserId` UUID.
    /// Used by the frontend to show per-browser volume sliders.
    #[serde(default)]
    pub browser_audio: HashMap<String, AudioSessionInfoDto>,
}
