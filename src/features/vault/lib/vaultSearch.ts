/**
 * In-memory search + ranking over the hydrated vault snapshot. All reads are
 * served from memory (the whole point of the vault's architecture), so this is
 * plain synchronous filtering — no debounce, no async.
 */

import type { Bookmark, MediaItem } from "../types";

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Score a bookmark against a lowercased query; higher = better, 0 = no match. */
function scoreBookmark(b: Bookmark, q: string): number {
  const title = b.title.toLowerCase();
  const url = b.url.toLowerCase();
  const tags = b.tags.map((t) => t.toLowerCase());

  if (title === q) return 100;
  if (title.startsWith(q)) return 80;
  if (tags.some((t) => t === q)) return 70;
  if (title.includes(q)) return 60;
  if (tags.some((t) => t.includes(q))) return 45;
  if (url.includes(q)) return 30;
  return 0;
}

/**
 * Filter + rank bookmarks. Empty query returns all bookmarks unchanged (the
 * caller applies pinned-first ordering). With a query, results are ranked by
 * score, then newest-first as a tiebreaker.
 */
export function searchBookmarks(bookmarks: readonly Bookmark[], query: string): Bookmark[] {
  const q = normalizeQuery(query);
  if (q === "") return [...bookmarks];

  return bookmarks
    .map((b) => ({ b, score: scoreBookmark(b, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.b.createdAtMs - a.b.createdAtMs)
    .map((x) => x.b);
}

/** Filter bookmarks to those carrying every tag in `tags` (AND semantics). */
export function filterBookmarksByTags(
  bookmarks: readonly Bookmark[],
  tags: ReadonlySet<string>,
): Bookmark[] {
  if (tags.size === 0) return [...bookmarks];
  return bookmarks.filter((b) => {
    const have = new Set(b.tags.map((t) => t.toLowerCase()));
    for (const t of tags) if (!have.has(t.toLowerCase())) return false;
    return true;
  });
}

/**
 * The bookmark-list collection filter. `null` = every bookmark;
 * [`UNFILED`] = only bookmarks in no collection (the derived default view);
 * any other value = that collection id.
 */
export const UNFILED = "__unfiled__" as const;
export type CollectionFilter = string | null;

export function filterBookmarksByCollection(
  bookmarks: readonly Bookmark[],
  filter: CollectionFilter,
): Bookmark[] {
  if (filter == null) return [...bookmarks];
  if (filter === UNFILED) return bookmarks.filter((b) => b.collectionIds.length === 0);
  return bookmarks.filter((b) => b.collectionIds.includes(filter));
}

/** Bookmark count per collection id, plus the size of the unfiled bucket. */
export function countByCollection(
  bookmarks: readonly Bookmark[],
): { byId: Map<string, number>; unfiled: number } {
  const byId = new Map<string, number>();
  let unfiled = 0;
  for (const b of bookmarks) {
    if (b.collectionIds.length === 0) {
      unfiled += 1;
      continue;
    }
    for (const id of b.collectionIds) byId.set(id, (byId.get(id) ?? 0) + 1);
  }
  return { byId, unfiled };
}

/** Pinned first, then newest-first, then id for stability. */
export function orderBookmarks(bookmarks: readonly Bookmark[]): Bookmark[] {
  return [...bookmarks].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      b.createdAtMs - a.createdAtMs ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** All distinct tags across the given bookmarks, with counts, sorted by label. */
export function collectTags(bookmarks: readonly Bookmark[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const b of bookmarks) {
    for (const t of b.tags) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }));
}

/** Score a media item against a lowercased query. */
function scoreMediaItem(m: MediaItem, q: string): number {
  const fields = [m.mediaTitle, m.pageTitle, m.artist, m.album, m.url];
  let best = 0;
  for (let i = 0; i < fields.length; i++) {
    const v = (fields[i] ?? "").toLowerCase();
    if (!v) continue;
    if (v === q) best = Math.max(best, 100 - i);
    else if (v.startsWith(q)) best = Math.max(best, 80 - i);
    else if (v.includes(q)) best = Math.max(best, 50 - i);
  }
  return best;
}

/** Filter + rank media items (used inside a playlist's detail view). */
export function searchMediaItems(items: readonly MediaItem[], query: string): MediaItem[] {
  const q = normalizeQuery(query);
  if (q === "") return [...items];
  return items
    .map((m) => ({ m, score: scoreMediaItem(m, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.m.addedAtMs - a.m.addedAtMs)
    .map((x) => x.m);
}
