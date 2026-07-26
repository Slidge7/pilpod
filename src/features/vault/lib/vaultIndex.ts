/**
 * Derived lookup indexes over the vault snapshot.
 *
 * The save menu asks two questions per open tab — "is this URL bookmarked, and
 * in which collections?" and "which playlists already hold it?" — and the
 * browser page can render hundreds of tab rows. Answering those by scanning
 * `bookmarks`/`mediaItems`/`playlists` per row is O(rows × vault); these
 * functions pay one O(vault) pass per `vault://update` instead and hand back
 * O(1) maps. Pure and side-effect free so `useVault` can memoize them and so
 * they are unit-testable without React.
 */

import type { Bookmark, BookmarkCollection, MediaItem, Playlist } from "../types";

/** `normalizedUrl` → bookmark. Later duplicates cannot occur (backend dedupes). */
export function indexBookmarksByUrl(
  bookmarks: readonly Bookmark[],
): Map<string, Bookmark> {
  const map = new Map<string, Bookmark>();
  for (const b of bookmarks) map.set(b.normalizedUrl, b);
  return map;
}

/**
 * `normalizedUrl` → ids of the playlists containing that media item.
 *
 * Two passes: media id → normalized url, then playlist membership. Only URLs
 * that are in at least one playlist appear, so a miss is the common case and
 * costs nothing.
 */
export function indexPlaylistIdsByUrl(
  mediaItems: readonly MediaItem[],
  playlists: readonly Playlist[],
): Map<string, ReadonlySet<string>> {
  if (mediaItems.length === 0 || playlists.length === 0) return new Map();
  const urlByItemId = new Map<string, string>();
  for (const m of mediaItems) urlByItemId.set(m.id, m.normalizedUrl);

  const out = new Map<string, Set<string>>();
  for (const p of playlists) {
    for (const itemId of p.itemIds) {
      const url = urlByItemId.get(itemId);
      if (url == null) continue; // defensive: backend GCs orphans
      const set = out.get(url);
      if (set) set.add(p.id);
      else out.set(url, new Set([p.id]));
    }
  }
  return out;
}

/** `normalizedUrl` → media-item id, for "remove this tab from that playlist". */
export function indexMediaIdsByUrl(
  mediaItems: readonly MediaItem[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of mediaItems) map.set(m.normalizedUrl, m.id);
  return map;
}

/** Empty set shared by every "not in any playlist/collection" answer. */
export const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

/**
 * Case-insensitive name lookup. The backend rejects duplicate names, so the UI
 * uses this to turn "create a collection that already exists" into "select the
 * existing one" instead of surfacing a `name_taken` error.
 */
export function findCollectionByName(
  collections: readonly BookmarkCollection[],
  name: string,
): BookmarkCollection | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return collections.find((c) => c.name.trim().toLowerCase() === needle) ?? null;
}
