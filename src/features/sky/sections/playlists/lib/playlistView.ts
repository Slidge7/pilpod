import type { MediaItem, Playlist } from "../../../../vault";
import { scoreFields, type SearchField } from "../../../search/lib/score";
import { parseQuery } from "../../../search/lib/query";
import { fold, hostOf } from "../../../search/lib/text";

/** Pure view rules for the Playlists section. */

export type PlaylistSummary = {
  tracks: MediaItem[];
  totalSecs: number;
  /** Up to four distinct artworks, for the cover mosaic. */
  artworks: string[];
};

export function summarizePlaylist(
  playlist: Playlist,
  mediaById: ReadonlyMap<string, MediaItem>,
): PlaylistSummary {
  const tracks: MediaItem[] = [];
  const artworks: string[] = [];
  let totalSecs = 0;
  for (const id of playlist.itemIds) {
    const item = mediaById.get(id);
    if (!item) continue;
    tracks.push(item);
    if (item.durationSecs && item.durationSecs > 0) totalSecs += item.durationSecs;
    const art = item.artworkUrl?.trim();
    if (art && artworks.length < 4 && !artworks.includes(art)) artworks.push(art);
  }
  return { tracks, totalSecs, artworks };
}

export function trackTitle(item: MediaItem): string {
  return item.mediaTitle?.trim() || item.pageTitle.trim() || hostOf(item.url) || item.url;
}

function trackFields(item: MediaItem): SearchField[] {
  return [
    { text: fold(item.mediaTitle), weight: 1 },
    { text: fold(item.artist), weight: 0.85 },
    { text: fold(item.pageTitle), weight: 0.8 },
    { text: fold(item.album), weight: 0.6 },
    { text: fold(hostOf(item.url)), weight: 0.5 },
  ];
}

export function trackMatches(item: MediaItem, terms: readonly string[]): boolean {
  return terms.length === 0 || scoreFields(trackFields(item), terms) > 0;
}

export type PlaylistMatch = {
  playlist: Playlist;
  /** Tracks in it matching the search (all of them with no search). */
  matchingTracks: number;
};

/**
 * Playlists for the overview grid: with a search, those whose name matches
 * or that hold a matching track — so typing an artist finds the playlists
 * they are on.
 */
export function filterPlaylists(
  playlists: readonly Playlist[],
  mediaById: ReadonlyMap<string, MediaItem>,
  search: string,
): PlaylistMatch[] {
  const { terms } = parseQuery(search);
  const out: PlaylistMatch[] = [];
  for (const playlist of playlists) {
    if (terms.length === 0) {
      out.push({ playlist, matchingTracks: playlist.itemIds.length });
      continue;
    }
    const nameHit = scoreFields([{ text: fold(playlist.name), weight: 1 }], terms) > 0;
    let matching = 0;
    for (const id of playlist.itemIds) {
      const item = mediaById.get(id);
      if (item && trackMatches(item, terms)) matching += 1;
    }
    if (nameHit || matching > 0) out.push({ playlist, matchingTracks: matching });
  }
  return out;
}

/** `ids` with the item at `from` moved to index `to` (clamped). Same list when nothing moves. */
export function moveItem<T>(ids: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= ids.length) return [...ids];
  const target = Math.max(0, Math.min(ids.length - 1, to));
  if (target === from) return [...ids];
  const next = [...ids];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}
