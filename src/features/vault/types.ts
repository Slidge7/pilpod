/**
 * TypeScript mirror of the Rust vault DTOs (serde camelCase, see
 * `src-tauri/src/vault/dto.rs`). Rust is the source of truth; keep these in
 * sync when the Rust structs change. Optional fields correspond to Rust
 * `Option<T>` with `skip_serializing_if = "Option::is_none"`, so an absent key
 * and `null` are both valid.
 */

export interface Bookmark {
  id: string;
  url: string;
  normalizedUrl: string;
  title: string;
  faviconUrl?: string | null;
  sourceOsBrowserId?: string | null;
  sourceProfileLabel?: string | null;
  createdAtMs: number;
  lastOpenedAtMs?: number | null;
  openCount: number;
  pinned: boolean;
  tags: string[];
  notes?: string | null;
  /**
   * Collections this bookmark belongs to. Empty = the default (unfiled) view,
   * which is derived, never a stored row. Membership lives here rather than on
   * the collection so "which collections is this tab in?" is an O(1) read —
   * see the module docs in `src-tauri/src/vault/dto.rs`.
   */
  collectionIds: string[];
}

/** A named group of bookmarks. Metadata only; membership is on the bookmark. */
export interface BookmarkCollection {
  id: string;
  name: string;
  emoji?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export type MediaKind = "video" | "audio" | "unknown";

export interface MediaItem {
  id: string;
  url: string;
  normalizedUrl: string;
  pageTitle: string;
  mediaTitle?: string | null;
  artist?: string | null;
  album?: string | null;
  artworkUrl?: string | null;
  durationSecs?: number | null;
  mediaMatchRule?: string | null;
  kind: MediaKind | string;
  sourceOsBrowserId?: string | null;
  addedAtMs: number;
  lastPlayedAtMs?: number | null;
  playCount: number;
}

export interface Playlist {
  id: string;
  name: string;
  emoji?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  itemIds: string[];
}

export interface VaultData {
  version: number;
  bookmarks: Bookmark[];
  mediaItems: MediaItem[];
  playlists: Playlist[];
  collections: BookmarkCollection[];
}

/** Event names (mirror of the Rust `EVT_*` consts). */
export const VAULT_EVENTS = {
  update: "vault://update",
} as const;

/** Result of `vault_open_entry` (Phase 5). */
export type OpenEntryResult = "focused" | "launched";

/** Argument payload for `vault_add_bookmark` (camelCase, matches Rust). */
export interface AddBookmarkArgs {
  url: string;
  title?: string | null;
  faviconUrl?: string | null;
  sourceOsBrowserId?: string | null;
  sourceProfileLabel?: string | null;
  tags?: string[];
  notes?: string | null;
  pinned?: boolean;
  /** Collections to file the new bookmark under. Omit/empty ⇒ default view. */
  collectionIds?: string[];
}

/** Argument payload for `vault_add_media_to_playlist` (Phase 3). */
export interface AddMediaArgs {
  url: string;
  pageTitle?: string | null;
  mediaTitle?: string | null;
  artist?: string | null;
  album?: string | null;
  artworkUrl?: string | null;
  durationSecs?: number | null;
  mediaMatchRule?: string | null;
  kind?: MediaKind | string | null;
  sourceOsBrowserId?: string | null;
}

/** Patch payload for `vault_update_bookmark`. Absent = unchanged. */
export interface BookmarkPatchArgs {
  id: string;
  title?: string;
  pinned?: boolean;
  tags?: string[];
  /** Omit to leave unchanged; empty string to clear; non-empty to set. */
  notes?: string;
  /** Omit to leave unchanged; present replaces the whole set (`[]` unfiles). */
  collectionIds?: string[];
}

/** Typed backend error codes surfaced to the UI. */
export const VAULT_ERRORS = {
  alreadySaved: "already_saved",
  notFound: "not_found",
  /** A collection with that name (case-insensitive) already exists. */
  nameTaken: "name_taken",
  tooManyCollections: "too_many_collections",
} as const;
