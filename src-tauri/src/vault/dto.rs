//! Serde DTOs for the vault store.
//!
//! Every frontend-facing payload is `camelCase` and mirrored in
//! `src/features/vault/types.ts`. Rust is the source of truth; the TS types are
//! a hand-kept mirror. Keep the two in sync when this file changes.
//!
//! The store file (`vault_store.json`) holds three collections plus a `version`
//! gate. Bookmarks are generic saved pages; media items carry rich playback
//! metadata; playlists are ordered lists of media-item ids. Only bookmarks are
//! mutated in Phase 1 — `mediaItems` and `playlists` are present (empty) so the
//! on-disk schema is stable and Phase 3 needs no version bump.

use serde::{Deserialize, Serialize};

/// Current on-disk schema version. A file with a *higher* version is treated as
/// from a newer app build: it is backed up and the vault starts empty rather
/// than silently dropping fields we don't understand.
pub const STORE_VERSION: u32 = 1;

fn unknown_kind() -> String {
    "unknown".to_string()
}

/// A saved page. Deduplicated by [`normalized_url`](Bookmark::normalized_url).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    /// `b_<uuid v4>`.
    pub id: String,
    pub url: String,
    /// Dedupe + live-tab matching key (see `vault/url.rs`).
    pub normalized_url: String,
    /// Captured from the tab; user-editable.
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon_url: Option<String>,
    /// Provenance: `DetectedBrowser.osBrowserId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_os_browser_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_profile_label: Option<String>,
    pub created_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_at_ms: Option<u64>,
    #[serde(default)]
    pub open_count: u32,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// A saved media tab with playback metadata. Referenced by playlists via id.
/// Defined now for schema stability; mutated starting in Phase 3.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    /// `m_<uuid v4>`.
    pub id: String,
    pub url: String,
    pub normalized_url: String,
    pub page_title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_match_rule: Option<String>,
    /// `"video" | "audio" | "unknown"`.
    #[serde(default = "unknown_kind")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_os_browser_id: Option<String>,
    pub added_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_played_at_ms: Option<u64>,
    #[serde(default)]
    pub play_count: u32,
}

/// An ordered, named collection of media-item ids. Mutated starting in Phase 3.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    /// `p_<uuid v4>`.
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    /// Ordered ids into [`VaultData::media_items`].
    #[serde(default)]
    pub item_ids: Vec<String>,
}

/// The complete vault, loaded fully into memory at startup and serialized back
/// to `vault_store.json` on debounced writes. Also the payload of the
/// `vault://update` event and the return of `vault_get_state`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultData {
    pub version: u32,
    #[serde(default)]
    pub bookmarks: Vec<Bookmark>,
    #[serde(default)]
    pub media_items: Vec<MediaItem>,
    #[serde(default)]
    pub playlists: Vec<Playlist>,
}

impl Default for VaultData {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            bookmarks: Vec::new(),
            media_items: Vec::new(),
            playlists: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_current_version_and_empty() {
        let d = VaultData::default();
        assert_eq!(d.version, STORE_VERSION);
        assert!(d.bookmarks.is_empty());
        assert!(d.media_items.is_empty());
        assert!(d.playlists.is_empty());
    }

    #[test]
    fn bookmark_round_trips_camel_case() {
        let b = Bookmark {
            id: "b_1".into(),
            url: "https://example.com".into(),
            normalized_url: "https://example.com".into(),
            title: "Example".into(),
            favicon_url: Some("https://example.com/f.ico".into()),
            source_os_browser_id: Some("chrome".into()),
            source_profile_label: None,
            created_at_ms: 42,
            last_opened_at_ms: None,
            open_count: 0,
            pinned: true,
            tags: vec!["docs".into(), "rust".into()],
            notes: None,
        };
        let json = serde_json::to_string(&b).unwrap();
        assert!(json.contains("\"normalizedUrl\""));
        assert!(json.contains("\"createdAtMs\""));
        // Omitted-when-None fields should not appear.
        assert!(!json.contains("sourceProfileLabel"));
        let back: Bookmark = serde_json::from_str(&json).unwrap();
        assert_eq!(b, back);
    }

    #[test]
    fn media_item_defaults_kind_unknown() {
        // A media item persisted without an explicit kind loads as "unknown".
        let json = r#"{
            "id":"m_1","url":"https://x","normalizedUrl":"https://x",
            "pageTitle":"P","addedAtMs":1
        }"#;
        let m: MediaItem = serde_json::from_str(json).unwrap();
        assert_eq!(m.kind, "unknown");
        assert_eq!(m.play_count, 0);
    }
}
