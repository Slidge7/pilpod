//! Serde DTOs for the vault store.
//!
//! Every frontend-facing payload is `camelCase` and mirrored in
//! `src/features/vault/types.ts`. Rust is the source of truth; the TS types are
//! a hand-kept mirror. Keep the two in sync when this file changes.
//!
//! The store file (`vault_store.json`) holds four pools plus a `version` gate.
//! Bookmarks are generic saved pages; media items carry rich playback metadata;
//! playlists are ordered lists of media-item ids; bookmark collections are
//! named groups of bookmarks. Only bookmarks are mutated in Phase 1 —
//! `mediaItems` and `playlists` are present (empty) so the on-disk schema is
//! stable and Phase 3 needs no version bump.
//!
//! ## Membership direction (deliberate asymmetry with playlists)
//!
//! A playlist owns an **ordered** `item_ids` list because playback order is the
//! feature. A bookmark collection owns nothing: membership lives on the
//! bookmark as [`Bookmark::collection_ids`]. That direction is chosen for three
//! reasons and should not be flipped casually:
//!
//! 1. **Performance** — the hot query is "which collections is *this tab* in?",
//!    asked once per open tab every time the save menu renders. Reading a field
//!    off the already-located bookmark is O(1); scanning every collection's
//!    member list would be O(collections × members).
//! 2. **Referential integrity** — deleting a bookmark cannot leave a dangling
//!    id anywhere, so there is no bookmark equivalent of `gc_orphan_media`.
//!    Deleting a collection is one `retain` pass over the bookmarks.
//! 3. **Ordering** — collections have no intrinsic order; bookmarks inside one
//!    inherit the canonical bookmark order (pinned, then newest). Nothing to
//!    store, nothing to keep in sync.

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
    /// Ids of the [`BookmarkCollection`]s this bookmark belongs to. Empty means
    /// "default collection" (unfiled) — that is a *derived* view, never a real
    /// collection row, so the default can never be renamed or deleted.
    /// `#[serde(default)]` keeps version-1 files written before collections
    /// existed loadable without a schema bump.
    #[serde(default)]
    pub collection_ids: Vec<String>,
}

/// A named group of bookmarks. Metadata only — see the module docs for why
/// membership is stored on [`Bookmark::collection_ids`] instead of here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkCollection {
    /// `c_<uuid v4>`.
    pub id: String,
    /// Unique case-insensitively (enforced in `state.rs`).
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
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
    /// Bookmark collections. `#[serde(default)]` ⇒ pre-collections stores load
    /// as an empty list (every existing bookmark lands in the default view).
    #[serde(default)]
    pub collections: Vec<BookmarkCollection>,
}

impl Default for VaultData {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            bookmarks: Vec::new(),
            media_items: Vec::new(),
            playlists: Vec::new(),
            collections: Vec::new(),
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
            collection_ids: vec!["c_1".into()],
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

    #[test]
    fn pre_collections_store_loads_with_empty_defaults() {
        // A version-1 file written before collections existed: no `collections`
        // key on the vault and no `collectionIds` on the bookmark. Both must
        // default rather than fail to parse (no STORE_VERSION bump needed).
        let json = r#"{
            "version":1,
            "bookmarks":[{
                "id":"b_1","url":"https://x","normalizedUrl":"x",
                "title":"X","createdAtMs":1
            }],
            "mediaItems":[],"playlists":[]
        }"#;
        let d: VaultData = serde_json::from_str(json).unwrap();
        assert!(d.collections.is_empty());
        assert!(d.bookmarks[0].collection_ids.is_empty());
    }

    #[test]
    fn collection_round_trips_camel_case() {
        let c = BookmarkCollection {
            id: "c_1".into(),
            name: "Reading".into(),
            emoji: Some("📚".into()),
            created_at_ms: 1,
            updated_at_ms: 2,
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("\"createdAtMs\""));
        assert_eq!(serde_json::from_str::<BookmarkCollection>(&json).unwrap(), c);
    }
}
