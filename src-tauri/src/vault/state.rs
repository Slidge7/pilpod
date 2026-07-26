//! In-memory vault state: the source of truth the frontend hydrates from and
//! trusts thereafter. Wraps [`VaultData`] behind a `Mutex`, tracks a dirty flag
//! for the debounced persist thread, and remembers the last-emitted content
//! hash so `vault://update` fires only on real changes (diff-before-emit, as in
//! `browser_tabs.rs`).
//!
//! Integrity rules live here and are unit-tested:
//!   * bookmarks are deduplicated by `normalized_url` — a duplicate add is
//!     rejected with [`ERR_ALREADY_SAVED`] so the UI can show "Already saved"
//!     and highlight the existing row.
//!   * a bookmark's `collection_ids` may only reference collections that exist;
//!     unknown ids are dropped on write (see [`sanitize_collection_ids`]) and
//!     deleting a collection detaches it from every bookmark. Together these
//!     make dangling references unrepresentable, so reads never have to filter.
//!   * collection names are unique case-insensitively ⇒ [`ERR_NAME_TAKEN`].
//!
//! Locking rule: mutation methods take the lock, mutate, mark dirty, and return
//! an owned result. Callers compute the snapshot/hash and emit *after* the lock
//! is released — this type never emits and never holds the lock across an emit.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::dto::{Bookmark, BookmarkCollection, MediaItem, Playlist, VaultData};

/// A duplicate `normalized_url` was submitted for a new bookmark.
pub const ERR_ALREADY_SAVED: &str = "already_saved";
/// The referenced id does not exist.
pub const ERR_NOT_FOUND: &str = "not_found";
/// The state mutex was poisoned by a panic in another thread.
pub const ERR_POISONED: &str = "state_poisoned";
/// A reorder payload was not a permutation of the playlist's current items.
pub const ERR_REORDER_MISMATCH: &str = "reorder_mismatch";
/// Another collection already uses this name (case-insensitive).
pub const ERR_NAME_TAKEN: &str = "name_taken";
/// The collection cap was reached.
pub const ERR_TOO_MANY_COLLECTIONS: &str = "too_many_collections";

/// Upper bound on bookmark collections. A picker list is the whole UI for these,
/// so the practical ceiling is far below this; the cap exists only to keep a
/// runaway caller from bloating the store.
pub const MAX_COLLECTIONS: usize = 500;

/// Drop unknown ids and duplicates from a bookmark's collection membership,
/// preserving order. Called on every write path so stored membership is always
/// referentially valid — readers get to skip validation entirely.
fn sanitize_collection_ids(data: &VaultData, ids: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(ids.len());
    for id in ids {
        if out.iter().any(|e| e == &id) {
            continue;
        }
        if data.collections.iter().any(|c| c.id == id) {
            out.push(id);
        }
    }
    out
}

/// Case-insensitive name match, ignoring `skip_id` (so a rename to the same
/// name with different casing is allowed).
fn name_taken(data: &VaultData, name: &str, skip_id: Option<&str>) -> bool {
    let needle = name.trim().to_lowercase();
    data.collections
        .iter()
        .any(|c| Some(c.id.as_str()) != skip_id && c.name.trim().to_lowercase() == needle)
}

/// Garbage-collect media items no playlist references. A media item is only
/// meaningful as a member of at least one playlist; once orphaned it is dropped
/// so the pool never accumulates junk (integrity rule, §4).
fn gc_orphan_media(data: &mut VaultData) {
    let referenced: std::collections::HashSet<String> = data
        .playlists
        .iter()
        .flat_map(|p| p.item_ids.iter().cloned())
        .collect();
    data.media_items.retain(|m| referenced.contains(&m.id));
}

/// Managed Tauri state. Registered as `Arc<VaultState>` so the debounced
/// persist thread can hold its own clone alongside the command handlers.
pub struct VaultState {
    data: Mutex<VaultData>,
    /// Set on every mutation; the persist thread clears it after a save.
    dirty: AtomicBool,
    /// Content hash of the last snapshot we emitted (0 = never emitted).
    last_emit_hash: AtomicU64,
}

pub type VaultStateHandle = Arc<VaultState>;

/// Fields a bookmark update may change. `None` = leave unchanged.
#[derive(Debug, Default, Clone)]
pub struct BookmarkPatch {
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub notes: Option<Option<String>>,
    /// Replaces the whole membership set (sanitized against known collections).
    pub collection_ids: Option<Vec<String>>,
}

impl VaultState {
    pub fn new(data: VaultData) -> Self {
        Self {
            data: Mutex::new(data),
            dirty: AtomicBool::new(false),
            last_emit_hash: AtomicU64::new(0),
        }
    }

    fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::SeqCst);
    }

    /// Atomically take the dirty flag (true ⇒ caller should persist).
    pub fn take_dirty(&self) -> bool {
        self.dirty.swap(false, Ordering::SeqCst)
    }

    /// Re-arm the dirty flag (persist failed; retry next tick).
    pub fn set_dirty(&self) {
        self.mark_dirty();
    }

    /// A canonical, deterministic clone of the vault for emitting/returning.
    /// Bookmarks: pinned first, then newest-first, then id. Other collections
    /// are ordered by id. Canonical order makes the content hash stable.
    pub fn snapshot(&self) -> VaultData {
        let guard = self.data.lock();
        let mut data = match guard {
            Ok(g) => g.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        };
        data.bookmarks.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then(b.created_at_ms.cmp(&a.created_at_ms))
                .then(a.id.cmp(&b.id))
        });
        data.media_items.sort_by(|a, b| a.id.cmp(&b.id));
        data.playlists.sort_by(|a, b| a.id.cmp(&b.id));
        // Collections are a picker list: alphabetical is the order the UI wants,
        // so canonicalize to it here and let every consumer render as-is.
        data.collections.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then(a.id.cmp(&b.id))
        });
        data
    }

    /// Stable content hash over the canonical snapshot (excludes nothing but
    /// ordering, which snapshot canonicalizes). Used for diff-before-emit.
    pub fn content_hash(&self) -> u64 {
        let snap = self.snapshot();
        // Serializing to a canonical string and hashing that is simple and
        // robust to field additions — no per-field hashing to keep in sync.
        let json = serde_json::to_string(&snap).unwrap_or_default();
        let mut h = DefaultHasher::new();
        json.hash(&mut h);
        h.finish()
    }

    /// If the current content differs from the last emit, record the new hash
    /// and return `true` (caller should emit). Otherwise `false`.
    pub fn should_emit(&self) -> bool {
        let hash = self.content_hash();
        let prev = self.last_emit_hash.swap(hash, Ordering::SeqCst);
        prev != hash
    }

    /// Clone the current vault for the persist thread.
    pub fn data_clone(&self) -> VaultData {
        match self.data.lock() {
            Ok(g) => g.clone(),
            Err(p) => p.into_inner().clone(),
        }
    }

    // ── Bookmark mutations ─────────────────────────────────────────────────

    /// Insert a bookmark. Rejects a duplicate `normalized_url` with
    /// [`ERR_ALREADY_SAVED`]. On success marks the state dirty and returns the
    /// stored bookmark.
    pub fn add_bookmark(&self, bookmark: Bookmark) -> Result<Bookmark, String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        if data
            .bookmarks
            .iter()
            .any(|b| b.normalized_url == bookmark.normalized_url)
        {
            return Err(ERR_ALREADY_SAVED.to_string());
        }
        let mut bookmark = bookmark;
        let ids = std::mem::take(&mut bookmark.collection_ids);
        bookmark.collection_ids = sanitize_collection_ids(&data, ids);
        data.bookmarks.push(bookmark.clone());
        drop(data);
        self.mark_dirty();
        Ok(bookmark)
    }

    /// Save-or-attach: the single write behind the tab save menu.
    ///
    /// If a bookmark with the same `normalized_url` already exists it is reused
    /// (never duplicated) and `collection_id` is attached to it; otherwise
    /// `bookmark` is inserted with that collection. `None` targets the default
    /// (unfiled) view and only ensures the bookmark exists. Idempotent, so
    /// double-clicking the same menu row is harmless.
    ///
    /// One command instead of read-then-write keeps the operation atomic under
    /// the state lock and costs the UI a single IPC round trip.
    pub fn save_bookmark_to_collection(
        &self,
        bookmark: Bookmark,
        collection_id: Option<&str>,
    ) -> Result<Bookmark, String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        if let Some(cid) = collection_id {
            if !data.collections.iter().any(|c| c.id == cid) {
                return Err(ERR_NOT_FOUND.to_string());
            }
        }
        // Resolve to an index first: holding an `iter_mut` borrow across both
        // match arms would conflict with the `push` in the insert arm.
        let existing_idx = data
            .bookmarks
            .iter()
            .position(|b| b.normalized_url == bookmark.normalized_url);
        let saved = match existing_idx {
            Some(idx) => {
                let existing = &mut data.bookmarks[idx];
                if let Some(cid) = collection_id {
                    if !existing.collection_ids.iter().any(|c| c == cid) {
                        existing.collection_ids.push(cid.to_string());
                    }
                }
                existing.clone()
            }
            None => {
                let mut fresh = bookmark;
                fresh.collection_ids = collection_id.map(|c| vec![c.to_string()]).unwrap_or_default();
                data.bookmarks.push(fresh.clone());
                fresh
            }
        };
        drop(data);
        self.mark_dirty();
        Ok(saved)
    }

    /// Apply a patch to an existing bookmark. Unknown id ⇒ [`ERR_NOT_FOUND`].
    pub fn update_bookmark(&self, id: &str, patch: BookmarkPatch) -> Result<Bookmark, String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        // Sanitize before the mutable borrow: needs to see `data.collections`.
        let collection_ids = patch
            .collection_ids
            .map(|ids| sanitize_collection_ids(&data, ids));
        let bm = data
            .bookmarks
            .iter_mut()
            .find(|b| b.id == id)
            .ok_or_else(|| ERR_NOT_FOUND.to_string())?;
        if let Some(ids) = collection_ids {
            bm.collection_ids = ids;
        }
        if let Some(title) = patch.title {
            bm.title = title;
        }
        if let Some(pinned) = patch.pinned {
            bm.pinned = pinned;
        }
        if let Some(tags) = patch.tags {
            bm.tags = tags;
        }
        if let Some(notes) = patch.notes {
            bm.notes = notes;
        }
        let updated = bm.clone();
        drop(data);
        self.mark_dirty();
        Ok(updated)
    }

    /// Remove a bookmark. Unknown id ⇒ [`ERR_NOT_FOUND`].
    pub fn remove_bookmark(&self, id: &str) -> Result<(), String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        let before = data.bookmarks.len();
        data.bookmarks.retain(|b| b.id != id);
        if data.bookmarks.len() == before {
            return Err(ERR_NOT_FOUND.to_string());
        }
        drop(data);
        self.mark_dirty();
        Ok(())
    }

    // ── Bookmark collections ───────────────────────────────────────────────

    /// Create a collection. Duplicate name (case-insensitive) ⇒
    /// [`ERR_NAME_TAKEN`] — a picker with two identically named rows is a bug,
    /// not a feature.
    pub fn create_collection(
        &self,
        collection: BookmarkCollection,
    ) -> Result<BookmarkCollection, String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        if data.collections.len() >= MAX_COLLECTIONS {
            return Err(ERR_TOO_MANY_COLLECTIONS.to_string());
        }
        if name_taken(&data, &collection.name, None) {
            return Err(ERR_NAME_TAKEN.to_string());
        }
        data.collections.push(collection.clone());
        drop(data);
        self.mark_dirty();
        Ok(collection)
    }

    /// Patch a collection's name/emoji. Unknown id ⇒ [`ERR_NOT_FOUND`];
    /// colliding name ⇒ [`ERR_NAME_TAKEN`].
    pub fn update_collection(
        &self,
        id: &str,
        name: Option<String>,
        emoji: Option<Option<String>>,
        now_ms: u64,
    ) -> Result<BookmarkCollection, String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        if !data.collections.iter().any(|c| c.id == id) {
            return Err(ERR_NOT_FOUND.to_string());
        }
        if let Some(n) = name.as_deref() {
            if name_taken(&data, n, Some(id)) {
                return Err(ERR_NAME_TAKEN.to_string());
            }
        }
        let c = data
            .collections
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| ERR_NOT_FOUND.to_string())?;
        if let Some(n) = name {
            c.name = n;
        }
        if let Some(e) = emoji {
            c.emoji = e;
        }
        c.updated_at_ms = now_ms;
        let out = c.clone();
        drop(data);
        self.mark_dirty();
        Ok(out)
    }

    /// Delete a collection and detach it from every bookmark. Bookmarks are
    /// never deleted — they simply fall back to the default (unfiled) view, so
    /// this is the safe inverse of "create". Unknown id ⇒ [`ERR_NOT_FOUND`].
    pub fn delete_collection(&self, id: &str) -> Result<(), String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        let before = data.collections.len();
        data.collections.retain(|c| c.id != id);
        if data.collections.len() == before {
            return Err(ERR_NOT_FOUND.to_string());
        }
        for b in data.bookmarks.iter_mut() {
            b.collection_ids.retain(|c| c != id);
        }
        drop(data);
        self.mark_dirty();
        Ok(())
    }

    /// Toggle one bookmark's membership of one collection. Returns the new
    /// membership state (`true` = now in the collection). Unknown bookmark or
    /// collection ⇒ [`ERR_NOT_FOUND`].
    pub fn toggle_bookmark_collection(
        &self,
        bookmark_id: &str,
        collection_id: &str,
    ) -> Result<bool, String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        if !data.collections.iter().any(|c| c.id == collection_id) {
            return Err(ERR_NOT_FOUND.to_string());
        }
        let bm = data
            .bookmarks
            .iter_mut()
            .find(|b| b.id == bookmark_id)
            .ok_or_else(|| ERR_NOT_FOUND.to_string())?;
        // Bound to a `let` first: a `match` keeps its scrutinee temporaries (here
        // the iterator's immutable borrow) alive across every arm, which would
        // clash with the `remove`/`push` below.
        let at = bm.collection_ids.iter().position(|c| c == collection_id);
        let now_in = match at {
            Some(idx) => {
                bm.collection_ids.remove(idx);
                false
            }
            None => {
                bm.collection_ids.push(collection_id.to_string());
                true
            }
        };
        drop(data);
        self.mark_dirty();
        Ok(now_in)
    }

    // ── Playlist & media mutations (Phase 3) ───────────────────────────────

    /// Create a playlist. Returns the stored playlist.
    pub fn create_playlist(&self, playlist: Playlist) -> Result<Playlist, String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        data.playlists.push(playlist.clone());
        drop(data);
        self.mark_dirty();
        Ok(playlist)
    }

    /// Patch a playlist's name/emoji. Unknown id ⇒ [`ERR_NOT_FOUND`].
    pub fn update_playlist(
        &self,
        id: &str,
        name: Option<String>,
        emoji: Option<Option<String>>,
        now_ms: u64,
    ) -> Result<Playlist, String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        let p = data
            .playlists
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| ERR_NOT_FOUND.to_string())?;
        if let Some(name) = name {
            p.name = name;
        }
        if let Some(emoji) = emoji {
            p.emoji = emoji;
        }
        p.updated_at_ms = now_ms;
        let out = p.clone();
        drop(data);
        self.mark_dirty();
        Ok(out)
    }

    /// Delete a playlist and GC any media items it orphaned. Unknown id ⇒
    /// [`ERR_NOT_FOUND`].
    pub fn delete_playlist(&self, id: &str) -> Result<(), String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        let before = data.playlists.len();
        data.playlists.retain(|p| p.id != id);
        if data.playlists.len() == before {
            return Err(ERR_NOT_FOUND.to_string());
        }
        gc_orphan_media(&mut data);
        drop(data);
        self.mark_dirty();
        Ok(())
    }

    /// Add a media item to a playlist. If a media item with the same
    /// `normalized_url` already exists in the pool it is reused (and its
    /// metadata refreshed) instead of inserting a duplicate; otherwise `item`
    /// is inserted. The (possibly reused) item id is appended to the playlist
    /// unless already present. Returns the effective item id. Unknown playlist
    /// ⇒ [`ERR_NOT_FOUND`] (no media is inserted in that case).
    pub fn add_media_to_playlist(
        &self,
        playlist_id: &str,
        item: MediaItem,
        now_ms: u64,
    ) -> Result<String, String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        if !data.playlists.iter().any(|p| p.id == playlist_id) {
            return Err(ERR_NOT_FOUND.to_string());
        }

        // Reuse-or-insert into the deduplicated media pool.
        let effective_id = if let Some(existing) = data
            .media_items
            .iter_mut()
            .find(|m| m.normalized_url == item.normalized_url)
        {
            existing.url = item.url;
            existing.page_title = item.page_title;
            existing.media_title = item.media_title;
            existing.artist = item.artist;
            existing.album = item.album;
            existing.artwork_url = item.artwork_url;
            existing.duration_secs = item.duration_secs;
            existing.media_match_rule = item.media_match_rule;
            existing.kind = item.kind;
            existing.source_os_browser_id = item.source_os_browser_id;
            existing.id.clone()
        } else {
            let id = item.id.clone();
            data.media_items.push(item);
            id
        };

        let playlist = data
            .playlists
            .iter_mut()
            .find(|p| p.id == playlist_id)
            .ok_or_else(|| ERR_NOT_FOUND.to_string())?;
        if !playlist.item_ids.iter().any(|id| id == &effective_id) {
            playlist.item_ids.push(effective_id.clone());
        }
        playlist.updated_at_ms = now_ms;

        drop(data);
        self.mark_dirty();
        Ok(effective_id)
    }

    /// Remove an item from a playlist, then GC it if now orphaned. Unknown
    /// playlist ⇒ [`ERR_NOT_FOUND`]; a missing item is a no-op success.
    pub fn remove_from_playlist(
        &self,
        playlist_id: &str,
        item_id: &str,
        now_ms: u64,
    ) -> Result<(), String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        let playlist = data
            .playlists
            .iter_mut()
            .find(|p| p.id == playlist_id)
            .ok_or_else(|| ERR_NOT_FOUND.to_string())?;
        playlist.item_ids.retain(|id| id != item_id);
        playlist.updated_at_ms = now_ms;
        gc_orphan_media(&mut data);
        drop(data);
        self.mark_dirty();
        Ok(())
    }

    /// Set a playlist's item order. `item_ids` must be a permutation of the
    /// playlist's current items (same multiset) or [`ERR_REORDER_MISMATCH`] is
    /// returned. Unknown playlist ⇒ [`ERR_NOT_FOUND`].
    pub fn reorder_playlist(
        &self,
        playlist_id: &str,
        item_ids: Vec<String>,
        now_ms: u64,
    ) -> Result<(), String> {
        let mut data = self.data.lock().map_err(|_| ERR_POISONED.to_string())?;
        let playlist = data
            .playlists
            .iter_mut()
            .find(|p| p.id == playlist_id)
            .ok_or_else(|| ERR_NOT_FOUND.to_string())?;
        let mut current = playlist.item_ids.clone();
        let mut proposed = item_ids.clone();
        current.sort();
        proposed.sort();
        if current != proposed {
            return Err(ERR_REORDER_MISMATCH.to_string());
        }
        playlist.item_ids = item_ids;
        playlist.updated_at_ms = now_ms;
        drop(data);
        self.mark_dirty();
        Ok(())
    }

    // ── Open counters (Phase 5) & whole-vault replace (Phase 6) ────────────

    /// Bump open/play counters for every bookmark and media item matching
    /// `normalized_url`. Returns true if anything matched. Called by the
    /// smart-open path after a successful focus/launch.
    pub fn mark_opened(&self, normalized_url: &str, now_ms: u64) -> bool {
        let mut data = match self.data.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let mut hit = false;
        for b in data
            .bookmarks
            .iter_mut()
            .filter(|b| b.normalized_url == normalized_url)
        {
            b.open_count = b.open_count.saturating_add(1);
            b.last_opened_at_ms = Some(now_ms);
            hit = true;
        }
        for m in data
            .media_items
            .iter_mut()
            .filter(|m| m.normalized_url == normalized_url)
        {
            m.play_count = m.play_count.saturating_add(1);
            m.last_played_at_ms = Some(now_ms);
            hit = true;
        }
        drop(data);
        if hit {
            self.mark_dirty();
        }
        hit
    }

    /// Replace the entire in-memory vault (used by import). Marks dirty so the
    /// new contents are persisted. Imported membership is sanitized here — an
    /// exported file could name collections that were edited away since, and
    /// the "no dangling references" invariant has to hold for imports too.
    pub fn replace_all(&self, data: VaultData) {
        let mut data = data;
        let known: std::collections::HashSet<String> =
            data.collections.iter().map(|c| c.id.clone()).collect();
        for b in data.bookmarks.iter_mut() {
            b.collection_ids.retain(|id| known.contains(id));
        }
        match self.data.lock() {
            Ok(mut g) => *g = data,
            Err(p) => *p.into_inner() = data,
        }
        self.mark_dirty();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bm(id: &str, norm: &str, created: u64, pinned: bool) -> Bookmark {
        Bookmark {
            id: id.into(),
            url: format!("https://{norm}"),
            normalized_url: norm.into(),
            title: id.into(),
            favicon_url: None,
            source_os_browser_id: None,
            source_profile_label: None,
            created_at_ms: created,
            last_opened_at_ms: None,
            open_count: 0,
            pinned,
            tags: vec![],
            notes: None,
            collection_ids: vec![],
        }
    }

    fn collection(id: &str, name: &str) -> BookmarkCollection {
        BookmarkCollection {
            id: id.into(),
            name: name.into(),
            emoji: None,
            created_at_ms: 1,
            updated_at_ms: 1,
        }
    }

    #[test]
    fn add_then_present() {
        let s = VaultState::new(VaultData::default());
        s.add_bookmark(bm("b_1", "example.com/a", 1, false)).unwrap();
        let snap = s.snapshot();
        assert!(snap.bookmarks.iter().any(|b| b.normalized_url == "example.com/a"));
        assert_eq!(snap.bookmarks.len(), 1);
    }

    #[test]
    fn duplicate_normalized_url_rejected() {
        let s = VaultState::new(VaultData::default());
        s.add_bookmark(bm("b_1", "example.com/a", 1, false)).unwrap();
        let err = s
            .add_bookmark(bm("b_2", "example.com/a", 2, false))
            .unwrap_err();
        assert_eq!(err, ERR_ALREADY_SAVED);
        assert_eq!(s.snapshot().bookmarks.len(), 1);
    }

    #[test]
    fn update_applies_only_present_fields() {
        let s = VaultState::new(VaultData::default());
        s.add_bookmark(bm("b_1", "example.com/a", 1, false)).unwrap();
        let patched = s
            .update_bookmark(
                "b_1",
                BookmarkPatch {
                    pinned: Some(true),
                    tags: Some(vec!["docs".into()]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(patched.pinned);
        assert_eq!(patched.tags, vec!["docs".to_string()]);
        // title untouched (was "b_1")
        assert_eq!(patched.title, "b_1");
    }

    #[test]
    fn update_notes_can_clear() {
        let s = VaultState::new(VaultData::default());
        let mut b = bm("b_1", "example.com/a", 1, false);
        b.notes = Some("keep".into());
        s.add_bookmark(b).unwrap();
        // Some(None) explicitly clears.
        let patched = s
            .update_bookmark(
                "b_1",
                BookmarkPatch {
                    notes: Some(None),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(patched.notes, None);
    }

    #[test]
    fn update_unknown_id_not_found() {
        let s = VaultState::new(VaultData::default());
        assert_eq!(
            s.update_bookmark("nope", BookmarkPatch::default()).unwrap_err(),
            ERR_NOT_FOUND
        );
    }

    #[test]
    fn remove_works_and_reports_missing() {
        let s = VaultState::new(VaultData::default());
        s.add_bookmark(bm("b_1", "example.com/a", 1, false)).unwrap();
        s.remove_bookmark("b_1").unwrap();
        assert_eq!(s.snapshot().bookmarks.len(), 0);
        assert_eq!(s.remove_bookmark("b_1").unwrap_err(), ERR_NOT_FOUND);
    }

    #[test]
    fn snapshot_orders_pinned_then_newest() {
        let s = VaultState::new(VaultData::default());
        s.add_bookmark(bm("b_old", "example.com/old", 1, false)).unwrap();
        s.add_bookmark(bm("b_new", "example.com/new", 5, false)).unwrap();
        s.add_bookmark(bm("b_pin", "example.com/pin", 2, true)).unwrap();
        let ids: Vec<String> = s.snapshot().bookmarks.iter().map(|b| b.id.clone()).collect();
        assert_eq!(ids, vec!["b_pin", "b_new", "b_old"]);
    }

    #[test]
    fn dirty_flag_set_by_mutation_and_taken_once() {
        let s = VaultState::new(VaultData::default());
        assert!(!s.take_dirty());
        s.add_bookmark(bm("b_1", "example.com/a", 1, false)).unwrap();
        assert!(s.take_dirty());
        assert!(!s.take_dirty(), "dirty should clear after being taken");
    }

    #[test]
    fn should_emit_true_on_change_false_when_unchanged() {
        let s = VaultState::new(VaultData::default());
        // Establish a baseline emit.
        assert!(s.should_emit());
        assert!(!s.should_emit());
        s.add_bookmark(bm("b_1", "example.com/a", 1, false)).unwrap();
        assert!(s.should_emit(), "content changed → emit");
        assert!(!s.should_emit(), "no change → no emit");
    }

    // ── Bookmark collections ───────────────────────────────────────────────

    #[test]
    fn create_collection_rejects_duplicate_name_case_insensitively() {
        let s = VaultState::new(VaultData::default());
        s.create_collection(collection("c_1", "Reading")).unwrap();
        assert_eq!(
            s.create_collection(collection("c_2", "  reading ")).unwrap_err(),
            ERR_NAME_TAKEN
        );
        assert_eq!(s.snapshot().collections.len(), 1);
    }

    #[test]
    fn rename_to_own_name_with_new_casing_is_allowed() {
        let s = VaultState::new(VaultData::default());
        s.create_collection(collection("c_1", "reading")).unwrap();
        let out = s
            .update_collection("c_1", Some("Reading".into()), None, 9)
            .unwrap();
        assert_eq!(out.name, "Reading");
        assert_eq!(out.updated_at_ms, 9);
    }

    #[test]
    fn rename_onto_another_collection_is_rejected() {
        let s = VaultState::new(VaultData::default());
        s.create_collection(collection("c_1", "A")).unwrap();
        s.create_collection(collection("c_2", "B")).unwrap();
        assert_eq!(
            s.update_collection("c_2", Some("a".into()), None, 1).unwrap_err(),
            ERR_NAME_TAKEN
        );
        // The failed rename left the collection untouched.
        let snap = s.snapshot();
        assert_eq!(snap.collections.iter().find(|c| c.id == "c_2").unwrap().name, "B");
    }

    #[test]
    fn unknown_collection_ids_are_dropped_on_write() {
        let s = VaultState::new(VaultData::default());
        s.create_collection(collection("c_1", "A")).unwrap();
        let mut b = bm("b_1", "example.com/a", 1, false);
        b.collection_ids = vec!["c_1".into(), "c_ghost".into(), "c_1".into()];
        let saved = s.add_bookmark(b).unwrap();
        assert_eq!(saved.collection_ids, vec!["c_1".to_string()]);
    }

    #[test]
    fn delete_collection_detaches_but_keeps_bookmarks() {
        let s = VaultState::new(VaultData::default());
        s.create_collection(collection("c_1", "A")).unwrap();
        let mut b = bm("b_1", "example.com/a", 1, false);
        b.collection_ids = vec!["c_1".into()];
        s.add_bookmark(b).unwrap();
        s.delete_collection("c_1").unwrap();
        let snap = s.snapshot();
        assert!(snap.collections.is_empty());
        assert_eq!(snap.bookmarks.len(), 1, "bookmark survives its collection");
        assert!(snap.bookmarks[0].collection_ids.is_empty());
        assert_eq!(s.delete_collection("c_1").unwrap_err(), ERR_NOT_FOUND);
    }

    #[test]
    fn save_to_collection_creates_then_attaches_without_duplicating() {
        let s = VaultState::new(VaultData::default());
        s.create_collection(collection("c_1", "A")).unwrap();
        s.create_collection(collection("c_2", "B")).unwrap();

        let first = s
            .save_bookmark_to_collection(bm("b_1", "example.com/a", 1, false), Some("c_1"))
            .unwrap();
        assert_eq!(first.collection_ids, vec!["c_1".to_string()]);

        // Same URL again (different candidate id) reuses the stored bookmark.
        let second = s
            .save_bookmark_to_collection(bm("b_2", "example.com/a", 2, false), Some("c_2"))
            .unwrap();
        assert_eq!(second.id, "b_1");
        assert_eq!(
            second.collection_ids,
            vec!["c_1".to_string(), "c_2".to_string()]
        );
        assert_eq!(s.snapshot().bookmarks.len(), 1, "never duplicated");
    }

    #[test]
    fn save_to_collection_is_idempotent_and_default_is_unfiled() {
        let s = VaultState::new(VaultData::default());
        s.create_collection(collection("c_1", "A")).unwrap();
        s.save_bookmark_to_collection(bm("b_1", "example.com/a", 1, false), Some("c_1"))
            .unwrap();
        let again = s
            .save_bookmark_to_collection(bm("b_1", "example.com/a", 1, false), Some("c_1"))
            .unwrap();
        assert_eq!(again.collection_ids, vec!["c_1".to_string()]);

        // `None` = default view: ensures existence, changes no membership.
        let unfiled = s
            .save_bookmark_to_collection(bm("b_9", "example.com/z", 1, false), None)
            .unwrap();
        assert!(unfiled.collection_ids.is_empty());
    }

    #[test]
    fn save_to_unknown_collection_inserts_nothing() {
        let s = VaultState::new(VaultData::default());
        let err = s
            .save_bookmark_to_collection(bm("b_1", "example.com/a", 1, false), Some("nope"))
            .unwrap_err();
        assert_eq!(err, ERR_NOT_FOUND);
        assert!(s.snapshot().bookmarks.is_empty());
    }

    #[test]
    fn toggle_membership_round_trips() {
        let s = VaultState::new(VaultData::default());
        s.create_collection(collection("c_1", "A")).unwrap();
        s.add_bookmark(bm("b_1", "example.com/a", 1, false)).unwrap();
        assert!(s.toggle_bookmark_collection("b_1", "c_1").unwrap());
        assert_eq!(s.snapshot().bookmarks[0].collection_ids, vec!["c_1".to_string()]);
        assert!(!s.toggle_bookmark_collection("b_1", "c_1").unwrap());
        assert!(s.snapshot().bookmarks[0].collection_ids.is_empty());
        assert_eq!(
            s.toggle_bookmark_collection("b_1", "ghost").unwrap_err(),
            ERR_NOT_FOUND
        );
    }

    #[test]
    fn update_bookmark_replaces_membership_and_sanitizes() {
        let s = VaultState::new(VaultData::default());
        s.create_collection(collection("c_1", "A")).unwrap();
        s.add_bookmark(bm("b_1", "example.com/a", 1, false)).unwrap();
        let out = s
            .update_bookmark(
                "b_1",
                BookmarkPatch {
                    collection_ids: Some(vec!["c_1".into(), "ghost".into()]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(out.collection_ids, vec!["c_1".to_string()]);
    }

    #[test]
    fn snapshot_orders_collections_alphabetically() {
        let s = VaultState::new(VaultData::default());
        s.create_collection(collection("c_1", "zeta")).unwrap();
        s.create_collection(collection("c_2", "Alpha")).unwrap();
        let names: Vec<String> = s.snapshot().collections.iter().map(|c| c.name.clone()).collect();
        assert_eq!(names, vec!["Alpha", "zeta"]);
    }

    #[test]
    fn replace_all_drops_dangling_membership_from_imports() {
        let s = VaultState::new(VaultData::default());
        let mut fresh = VaultData::default();
        let mut b = bm("b_1", "a.com", 1, false);
        b.collection_ids = vec!["c_gone".into()];
        fresh.bookmarks.push(b);
        s.replace_all(fresh);
        assert!(s.snapshot().bookmarks[0].collection_ids.is_empty());
    }

    // ── Phase 3: playlists & media ─────────────────────────────────────────

    fn playlist(id: &str, name: &str) -> Playlist {
        Playlist {
            id: id.into(),
            name: name.into(),
            emoji: None,
            created_at_ms: 1,
            updated_at_ms: 1,
            item_ids: vec![],
        }
    }

    fn media(id: &str, norm: &str) -> MediaItem {
        MediaItem {
            id: id.into(),
            url: format!("https://{norm}"),
            normalized_url: norm.into(),
            page_title: id.into(),
            media_title: None,
            artist: None,
            album: None,
            artwork_url: None,
            duration_secs: None,
            media_match_rule: None,
            kind: "unknown".into(),
            source_os_browser_id: None,
            added_at_ms: 1,
            last_played_at_ms: None,
            play_count: 0,
        }
    }

    #[test]
    fn add_media_dedupes_pool_and_appends_to_playlist() {
        let s = VaultState::new(VaultData::default());
        s.create_playlist(playlist("p_1", "A")).unwrap();
        s.create_playlist(playlist("p_2", "B")).unwrap();
        let id1 = s
            .add_media_to_playlist("p_1", media("m_1", "song.com/x"), 10)
            .unwrap();
        // Same normalized url into another playlist reuses the pooled item.
        let id2 = s
            .add_media_to_playlist("p_2", media("m_2", "song.com/x"), 11)
            .unwrap();
        assert_eq!(id1, id2, "duplicate normalized url reuses the same item");
        let snap = s.snapshot();
        assert_eq!(snap.media_items.len(), 1, "pool is deduplicated");
        assert_eq!(snap.playlists.iter().find(|p| p.id == "p_1").unwrap().item_ids, vec![id1.clone()]);
        assert_eq!(snap.playlists.iter().find(|p| p.id == "p_2").unwrap().item_ids, vec![id2]);
    }

    #[test]
    fn add_media_to_missing_playlist_inserts_nothing() {
        let s = VaultState::new(VaultData::default());
        let err = s
            .add_media_to_playlist("nope", media("m_1", "song.com/x"), 10)
            .unwrap_err();
        assert_eq!(err, ERR_NOT_FOUND);
        assert_eq!(s.snapshot().media_items.len(), 0);
    }

    #[test]
    fn add_same_media_twice_to_one_playlist_is_idempotent() {
        let s = VaultState::new(VaultData::default());
        s.create_playlist(playlist("p_1", "A")).unwrap();
        let a = s.add_media_to_playlist("p_1", media("m_1", "song.com/x"), 1).unwrap();
        let b = s.add_media_to_playlist("p_1", media("m_2", "song.com/x"), 2).unwrap();
        assert_eq!(a, b);
        let p = s.snapshot().playlists.into_iter().find(|p| p.id == "p_1").unwrap();
        assert_eq!(p.item_ids.len(), 1);
    }

    #[test]
    fn remove_from_playlist_gcs_orphan_media() {
        let s = VaultState::new(VaultData::default());
        s.create_playlist(playlist("p_1", "A")).unwrap();
        let id = s.add_media_to_playlist("p_1", media("m_1", "song.com/x"), 1).unwrap();
        s.remove_from_playlist("p_1", &id, 2).unwrap();
        let snap = s.snapshot();
        assert!(snap.media_items.is_empty(), "orphaned media is garbage-collected");
        assert!(snap.playlists[0].item_ids.is_empty());
    }

    #[test]
    fn media_referenced_by_two_playlists_survives_one_removal() {
        let s = VaultState::new(VaultData::default());
        s.create_playlist(playlist("p_1", "A")).unwrap();
        s.create_playlist(playlist("p_2", "B")).unwrap();
        let id = s.add_media_to_playlist("p_1", media("m_1", "song.com/x"), 1).unwrap();
        s.add_media_to_playlist("p_2", media("m_2", "song.com/x"), 1).unwrap();
        s.remove_from_playlist("p_1", &id, 2).unwrap();
        assert_eq!(s.snapshot().media_items.len(), 1, "still referenced by p_2");
    }

    #[test]
    fn delete_playlist_gcs_media_and_reports_missing() {
        let s = VaultState::new(VaultData::default());
        s.create_playlist(playlist("p_1", "A")).unwrap();
        s.add_media_to_playlist("p_1", media("m_1", "song.com/x"), 1).unwrap();
        s.delete_playlist("p_1").unwrap();
        assert!(s.snapshot().media_items.is_empty());
        assert_eq!(s.delete_playlist("p_1").unwrap_err(), ERR_NOT_FOUND);
    }

    #[test]
    fn reorder_requires_same_multiset() {
        let s = VaultState::new(VaultData::default());
        s.create_playlist(playlist("p_1", "A")).unwrap();
        let a = s.add_media_to_playlist("p_1", media("m_a", "s.com/a"), 1).unwrap();
        let b = s.add_media_to_playlist("p_1", media("m_b", "s.com/b"), 1).unwrap();
        s.reorder_playlist("p_1", vec![b.clone(), a.clone()], 2).unwrap();
        assert_eq!(
            s.snapshot().playlists[0].item_ids,
            vec![b.clone(), a.clone()]
        );
        // Wrong set is rejected.
        assert_eq!(
            s.reorder_playlist("p_1", vec![a], 3).unwrap_err(),
            ERR_REORDER_MISMATCH
        );
    }

    #[test]
    fn update_playlist_patches_and_bumps_timestamp() {
        let s = VaultState::new(VaultData::default());
        s.create_playlist(playlist("p_1", "A")).unwrap();
        let out = s
            .update_playlist("p_1", Some("Renamed".into()), Some(Some("🎧".into())), 99)
            .unwrap();
        assert_eq!(out.name, "Renamed");
        assert_eq!(out.emoji.as_deref(), Some("🎧"));
        assert_eq!(out.updated_at_ms, 99);
    }

    #[test]
    fn mark_opened_bumps_bookmark_and_media_counters() {
        let s = VaultState::new(VaultData::default());
        s.add_bookmark(bm("b_1", "song.com/x", 1, false)).unwrap();
        s.create_playlist(playlist("p_1", "A")).unwrap();
        s.add_media_to_playlist("p_1", media("m_1", "song.com/x"), 1).unwrap();
        assert!(s.mark_opened("song.com/x", 123));
        let snap = s.snapshot();
        assert_eq!(snap.bookmarks[0].open_count, 1);
        assert_eq!(snap.bookmarks[0].last_opened_at_ms, Some(123));
        assert_eq!(snap.media_items[0].play_count, 1);
        assert_eq!(snap.media_items[0].last_played_at_ms, Some(123));
        assert!(!s.mark_opened("nothing.com", 1), "no match returns false");
    }

    #[test]
    fn replace_all_swaps_contents() {
        let s = VaultState::new(VaultData::default());
        s.add_bookmark(bm("b_1", "a.com", 1, false)).unwrap();
        let mut fresh = VaultData::default();
        fresh.bookmarks.push(bm("b_2", "b.com", 2, false));
        s.replace_all(fresh);
        let snap = s.snapshot();
        assert_eq!(snap.bookmarks.len(), 1);
        assert_eq!(snap.bookmarks[0].id, "b_2");
    }
}
