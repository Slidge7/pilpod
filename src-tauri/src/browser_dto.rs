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

/// Per-window rollup derived from a slot's tabs (Phase 4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWindowInfo {
    pub window_id: i64,
    pub focused: bool,
    pub tab_count: u32,
    pub audible_count: u32,
}

/// Derive the window list from a tab set: focused window first, then by id.
pub fn windows_for_tabs(tabs: &[BrowserTab]) -> Vec<BrowserWindowInfo> {
    let mut by_window: HashMap<i64, BrowserWindowInfo> = HashMap::new();
    for tab in tabs {
        let w = by_window
            .entry(tab.window_id)
            .or_insert_with(|| BrowserWindowInfo {
                window_id: tab.window_id,
                focused: false,
                tab_count: 0,
                audible_count: 0,
            });
        w.tab_count += 1;
        if tab.window_focused {
            w.focused = true;
        }
        if tab.audible {
            w.audible_count += 1;
        }
    }
    let mut windows: Vec<BrowserWindowInfo> = by_window.into_values().collect();
    windows.sort_by_key(|w| (!w.focused, w.window_id));
    windows
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
    ///
    /// Superseded by [`Self::activation_state`], which distinguishes the cases
    /// this boolean flattens together. Kept so existing consumers keep working;
    /// new code should read `activation_state`.
    pub extension_installed: bool,
    /// Setup/verification state for this browser: `inactive`, `setupPending`,
    /// `active`, `revoked` or `skipped`. The dashboard gates features on
    /// `active`; the setup screen drives everything else.
    #[serde(default)]
    pub activation_state: crate::extension_setup::ActivationState,
    /// True when the extension sent a POST within the last 3 seconds.
    pub extension_connected: bool,
    pub tab_count: u32,
    pub tabs: Vec<BrowserTab>,
    /// Per-window rollup (Phase 4): focused window first.
    #[serde(default)]
    pub windows: Vec<BrowserWindowInfo>,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
    /// Per-tab control capabilities advertised by the extension. Drive which
    /// transport buttons the desktop UI renders/enables for this tab.
    #[serde(default)]
    pub can_seek: bool,
    #[serde(default)]
    pub can_pip: bool,
    #[serde(default)]
    pub can_next: bool,
    #[serde(default)]
    pub can_prev: bool,
    /// True when this tab's video is currently in a Picture-in-Picture window.
    #[serde(default)]
    pub in_pip: bool,
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

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(window_id: i64, focused: bool, audible: bool) -> BrowserTab {
        BrowserTab {
            tab_id: 0,
            window_id,
            window_focused: focused,
            audible,
            ..Default::default()
        }
    }

    #[test]
    fn windows_rollup_counts_tabs_and_audible() {
        let tabs = vec![
            tab(10, false, true),
            tab(10, false, false),
            tab(20, true, true),
        ];
        let windows = windows_for_tabs(&tabs);
        assert_eq!(windows.len(), 2);
        // Focused window first.
        assert_eq!(windows[0].window_id, 20);
        assert!(windows[0].focused);
        assert_eq!(windows[0].tab_count, 1);
        assert_eq!(windows[0].audible_count, 1);
        assert_eq!(windows[1].window_id, 10);
        assert_eq!(windows[1].tab_count, 2);
        assert_eq!(windows[1].audible_count, 1);
    }

    #[test]
    fn windows_sorted_by_id_when_none_focused() {
        let tabs = vec![tab(30, false, false), tab(10, false, false), tab(20, false, false)];
        let ids: Vec<i64> = windows_for_tabs(&tabs).iter().map(|w| w.window_id).collect();
        assert_eq!(ids, vec![10, 20, 30]);
    }

    #[test]
    fn empty_tabs_yield_no_windows() {
        assert!(windows_for_tabs(&[]).is_empty());
    }
}
