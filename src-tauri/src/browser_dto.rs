use std::collections::HashMap;

use serde::{Deserialize, Serialize};

// ── OS / extension browser types ────────────────────────────────────────────

/// Internal-only: result of the OS browser scan. Not serialised to the frontend directly.
#[derive(Debug, Clone, PartialEq)]
pub struct DetectedBrowserInfo {
    /// Stable lower-case key: "chrome", "msedge", "firefox", "brave", etc.
    pub id: String,
    /// Human-readable display name: "Google Chrome", etc.
    pub display_name: String,
    /// True when the browser process was seen in the current OS scan.
    pub running: bool,
}

/// One entry per extension profile or OS browser.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedBrowser {
    /// Extension profile UUID (`slot.browser_id`) when a slot exists; otherwise the
    /// OS browser id (e.g. `"chrome"`) for placeholder rows with no extension yet.
    pub id: String,
    /// OS-level browser key: `"chrome"`, `"msedge"`, etc. — used for metadata lookup.
    pub os_browser_id: String,
    pub display_name: String,
    /// Disambiguates multiple profiles of the same OS browser (e.g. two Chrome profiles).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_label: Option<String>,
    /// True when the browser process is currently running (from OS scan).
    pub running: bool,
    /// True when the extension has ever successfully connected to PilPod for
    /// this browser. Persisted across app restarts.
    pub extension_installed: bool,
    /// True when the extension sent a POST within the last 3 seconds.
    pub extension_connected: bool,
    pub tab_count: u32,
    pub tabs: Vec<BrowserTab>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_secs: Option<u64>,
    #[serde(default)]
    pub extension_reconnecting: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
}

/// Emitted on `"browsers://update"` and returned by `get_browsers`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowsersUpdatePayload {
    pub browsers: Vec<DetectedBrowser>,
    /// Per-browser WASAPI audio, keyed by extension `browserId` UUID.
    #[serde(default)]
    pub browser_audio: HashMap<String, AudioSessionInfoDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTab {
    pub tab_id: i64,
    pub window_id: i64,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, alias = "favIconUrl")]
    pub favicon_url: String,
    #[serde(default)]
    pub tab_state: String,
    #[serde(default)]
    pub active: bool,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<TabMedia>,
    #[serde(default)]
    pub browser_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabMedia {
    #[serde(default)]
    pub playback_state: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub artwork_url: String,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub current_time: f64,
    #[serde(default)]
    pub page_visible: bool,
    #[serde(default)]
    pub user_idle_ms: u64,
    #[serde(default)]
    pub document_state: String,
    #[serde(default = "default_tab_volume")]
    pub tab_volume: f64,
    #[serde(default)]
    pub tab_muted: bool,
}

fn default_tab_volume() -> f64 {
    100.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSessionInfoDto {
    pub instance_id: String,
    pub volume: f32,
    pub muted: bool,
}
