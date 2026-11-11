//! History DTOs — the shapes the recorder produces, the store persists and the
//! frontend receives (serde camelCase, mirrored in
//! `src/features/history/types.ts`). Rust is the source of truth; keep the
//! TypeScript mirror in sync when these change.

use serde::{Deserialize, Serialize};

/// One stretch of time a tab spent on one URL.
///
/// A visit starts when a tab lands on an `http(s)` URL and ends when the tab
/// navigates elsewhere, closes, or its browser goes away. Titles and favicons
/// arrive after the URL does, so both are refreshed while the visit is open.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageVisit {
    pub id: i64,
    /// Fragment-free URL — anchors within a page are not separate visits.
    pub url: String,
    /// Latest non-empty title seen. Empty only if the page never reported one.
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon_url: Option<String>,
    /// Extension profile UUID at record time (`DetectedBrowser::id`).
    pub browser_id: String,
    /// Catalog id (`"chrome"`, `"msedge"`…) — survives the profile disappearing.
    pub os_browser_id: String,
    /// Display label at record time (profile label when there was one), so an
    /// entry stays readable after its browser is uninstalled.
    pub browser_name: String,
    pub started_at_ms: i64,
    /// `None` while the page is still open.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at_ms: Option<i64>,
}

/// One piece of media that actually played in a tab.
///
/// Only media that played for at least [`super::recorder::MIN_PLAY_MS`] is
/// stored, so autoplaying previews and accidental clicks never show up.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPlay {
    pub id: i64,
    pub url: String,
    /// Media-session title, falling back to the page title.
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork_url: Option<String>,
    pub page_title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<f64>,
    /// Wall-clock time spent in the `playing` state.
    pub played_ms: i64,
    pub browser_id: String,
    pub os_browser_id: String,
    pub browser_name: String,
    pub started_at_ms: i64,
    /// `None` while the media is still loaded in its tab.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at_ms: Option<i64>,
}

/// The two history lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HistoryKind {
    Pages,
    Media,
}

/// Keyset pagination cursor: the last row of the previous page. Rows are
/// ordered newest-first by `(started_at_ms, id)`, which is unique and stable
/// while new rows keep arriving at the top.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCursor {
    pub started_at_ms: i64,
    pub id: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    /// Case-insensitive substring over title / URL (and artist / album for media).
    #[serde(default)]
    pub search: Option<String>,
    /// Return rows strictly older than this cursor. `None` = from the newest.
    #[serde(default)]
    pub before: Option<HistoryCursor>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage<T> {
    pub items: Vec<T>,
    /// Cursor for the next (older) page; `None` when this page is the last.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next: Option<HistoryCursor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySettings {
    /// When `false` nothing new is recorded; existing history is kept.
    pub recording: bool,
    /// Rows older than this are purged. `0` keeps history forever.
    pub retention_days: u32,
}

impl Default for HistorySettings {
    fn default() -> Self {
        Self {
            recording: true,
            retention_days: 90,
        }
    }
}

/// Upper bound on `retention_days` (ten years). Anything larger is a typo.
pub const MAX_RETENTION_DAYS: u32 = 3650;
