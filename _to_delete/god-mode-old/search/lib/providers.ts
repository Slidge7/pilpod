import type { BrowserTab, DetectedBrowser } from "../../../../types/media";
import type { MediaPlay, PageVisit } from "../../../history";
import {
  browserDisplayLabel,
  faviconFromUrl,
  isTabPlaying,
  tabHasMediaControls,
  tabIsLinkIdentifiedMedia,
} from "../../../media-dashboard";
import type { Bookmark, MediaItem, Playlist, VaultData } from "../../../vault";
import { visibleTabs } from "../../data/browserStats";
import { scoreFields, type SearchField } from "./score";
import type { ParsedQuery } from "./query";
import { fold, hostMatchesSite, hostOf } from "./text";
import type { CommandId, HitBadge, SearchHit } from "./types";

/**
 * Search providers: one indexer and one searcher per kind of result.
 *
 * Indexing (folding every field) is the expensive part and runs only when the
 * underlying data changes — once per vault update, once per browser tick —
 * never per keystroke. Searching is then a tight loop over pre-folded fields.
 */

type Doc<T> = { item: T; fields: SearchField[]; host: string | null };

function field(text: string | null | undefined, weight: number): SearchField {
  return { text: fold(text), weight };
}

function initial(text: string): string {
  const ch = text.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function joinMeta(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(" · ");
}

function sortByScore(hits: SearchHit[]): SearchHit[] {
  return hits.sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title),
  );
}

// ── Open tabs ────────────────────────────────────────────────────────────

export type TabEntry = { browserId: string; browserName: string; tab: BrowserTab };

export function indexTabs(browsers: readonly DetectedBrowser[]): Doc<TabEntry>[] {
  const docs: Doc<TabEntry>[] = [];
  for (const browser of browsers) {
    const browserName = browserDisplayLabel(browser);
    const browserField = field(browserName, 0.35);
    for (const tab of visibleTabs(browser)) {
      const host = hostOf(tab.url);
      docs.push({
        item: { browserId: browser.id, browserName, tab },
        host,
        fields: [
          field(tab.title, 1),
          field(tab.media?.title, 1),
          field(tab.media?.artist, 0.85),
          field(tab.media?.album, 0.6),
          field(host, 0.7),
          field(tab.url, 0.3),
          browserField,
        ],
      });
    }
  }
  return docs;
}

function tabBadge(tab: BrowserTab): HitBadge | null {
  if (isTabPlaying(tab)) return "playing";
  if (tabHasMediaControls(tab)) return "paused";
  if (tab.audible) return "audible";
  if (tab.pinned) return "pinned";
  return null;
}

function passesFlags(tab: BrowserTab, q: ParsedQuery): boolean {
  for (const flag of q.flags) {
    if (flag === "playing" && !isTabPlaying(tab)) return false;
    if (flag === "audible" && tab.audible !== true) return false;
    if (flag === "pinned" && tab.pinned !== true) return false;
    if (flag === "media" && !tabIsLinkIdentifiedMedia(tab)) return false;
  }
  return true;
}

export function searchTabs(docs: readonly Doc<TabEntry>[], q: ParsedQuery): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const { tab, browserId, browserName } = doc.item;
    if (q.site && !hostMatchesSite(doc.host, q.site)) continue;
    if (!passesFlags(tab, q)) continue;
    const base = scoreFields(doc.fields, q.terms);
    if (base === 0) continue;

    const playing = isTabPlaying(tab);
    const score =
      base + (playing ? 10 : 0) + (tab.audible ? 4 : 0) + (tab.active ? 2 : 0);
    const title =
      tab.title?.trim() || tab.media?.title?.trim() || doc.host || tab.url;
    const artwork = tab.media?.artworkUrl?.trim() || null;
    const favicon =
      tab.favIconUrl?.trim() || tab.faviconUrl?.trim() || faviconFromUrl(tab.url);

    hits.push({
      key: `tab:${browserId}:${tab.tabId}`,
      group: "tabs",
      score,
      title,
      subtitle: joinMeta([tab.media?.artist, doc.host, browserName]),
      image: artwork ?? (favicon?.startsWith("chrome://") ? null : favicon),
      imageKind: artwork ? "art" : "icon",
      glyph: initial(doc.host ?? title),
      badge: tabBadge(tab),
      target: { type: "tab", browserId, browserName, tab },
    });
  }
  return sortByScore(hits);
}

// ── Bookmarks ────────────────────────────────────────────────────────────

export function indexBookmarks(vault: VaultData): Doc<Bookmark>[] {
  const collectionName = new Map(vault.collections.map((c) => [c.id, c.name]));
  return vault.bookmarks.map((bookmark) => {
    const host = hostOf(bookmark.url);
    return {
      item: bookmark,
      host,
      fields: [
        field(bookmark.title, 1),
        field(bookmark.tags.join(" "), 0.85),
        field(host, 0.7),
        field(
          bookmark.collectionIds.map((id) => collectionName.get(id) ?? "").join(" "),
          0.5,
        ),
        field(bookmark.notes, 0.35),
        field(bookmark.url, 0.3),
      ],
    };
  });
}

/** Ranked, filtered bookmarks — the global search and the Bookmarks section share it. */
export function rankBookmarks(
  docs: readonly Doc<Bookmark>[],
  q: Pick<ParsedQuery, "terms" | "site">,
): Array<{ bookmark: Bookmark; score: number }> {
  const out: Array<{ bookmark: Bookmark; score: number }> = [];
  for (const doc of docs) {
    if (q.site && !hostMatchesSite(doc.host, q.site)) continue;
    const base = scoreFields(doc.fields, q.terms);
    if (base === 0) continue;
    const b = doc.item;
    out.push({
      bookmark: b,
      score: base + (b.pinned ? 4 : 0) + Math.min(b.openCount, 20) * 0.2,
    });
  }
  return out;
}

export function searchBookmarks(docs: readonly Doc<Bookmark>[], q: ParsedQuery): SearchHit[] {
  if (q.flags.size > 0) return [];
  return sortByScore(
    rankBookmarks(docs, q).map(({ bookmark, score }) => {
      const host = hostOf(bookmark.url);
      const title = bookmark.title.trim() || host || bookmark.url;
      return {
        key: `bookmark:${bookmark.id}`,
        group: "bookmarks" as const,
        score,
        title,
        subtitle: joinMeta([host, bookmark.tags.map((t) => `#${t}`).join(" ")]),
        image: bookmark.faviconUrl || faviconFromUrl(bookmark.url),
        imageKind: "icon" as const,
        glyph: initial(host ?? title),
        badge: bookmark.pinned ? ("pinned" as const) : null,
        target: { type: "bookmark" as const, bookmark },
      };
    }),
  );
}

// ── Playlists and their tracks ───────────────────────────────────────────

export type PlaylistIndex = {
  playlists: Doc<{ playlist: Playlist; artwork: string | null }>[];
  /** One entry per media item, filed under the first playlist holding it. */
  tracks: Doc<{ item: MediaItem; playlist: Playlist }>[];
};

export function indexPlaylists(vault: VaultData): PlaylistIndex {
  const mediaById = new Map(vault.mediaItems.map((m) => [m.id, m]));
  const playlists: PlaylistIndex["playlists"] = [];
  const tracks: PlaylistIndex["tracks"] = [];
  const seen = new Set<string>();

  for (const playlist of vault.playlists) {
    let artwork: string | null = null;
    for (const id of playlist.itemIds) {
      const item = mediaById.get(id);
      if (!artwork && item?.artworkUrl) artwork = item.artworkUrl;
      if (!item || seen.has(id)) continue;
      seen.add(id);
      const host = hostOf(item.url);
      tracks.push({
        item: { item, playlist },
        host,
        fields: [
          field(item.mediaTitle, 1),
          field(item.artist, 0.85),
          field(item.pageTitle, 0.8),
          field(item.album, 0.6),
          field(host, 0.5),
          field(playlist.name, 0.3),
        ],
      });
    }
    playlists.push({
      item: { playlist, artwork },
      host: null,
      fields: [field(playlist.name, 1)],
    });
  }
  return { playlists, tracks };
}

export function searchPlaylists(
  index: PlaylistIndex,
  q: ParsedQuery,
  activePlaylistId: string | null,
): SearchHit[] {
  if (q.flags.size > 0) return [];
  const hits: SearchHit[] = [];

  if (!q.site) {
    for (const doc of index.playlists) {
      const base = scoreFields(doc.fields, q.terms);
      if (base === 0) continue;
      const { playlist, artwork } = doc.item;
      const live = playlist.id === activePlaylistId;
      const count = playlist.itemIds.length;
      hits.push({
        key: `playlist:${playlist.id}`,
        group: "playlists",
        score: base + 6 + (live ? 6 : 0),
        title: playlist.name,
        subtitle: `Playlist · ${count} track${count === 1 ? "" : "s"}`,
        image: artwork,
        imageKind: "art",
        glyph: playlist.emoji || initial(playlist.name),
        badge: live ? "playlist-live" : null,
        target: { type: "playlist", playlist },
      });
    }
  }

  for (const doc of index.tracks) {
    if (q.site && !hostMatchesSite(doc.host, q.site)) continue;
    const base = scoreFields(doc.fields, q.terms);
    if (base === 0) continue;
    const { item, playlist } = doc.item;
    const title = item.mediaTitle?.trim() || item.pageTitle.trim() || doc.host || item.url;
    hits.push({
      key: `track:${item.id}`,
      group: "playlists",
      score: base,
      title,
      subtitle: joinMeta([item.artist, `in ${playlist.name}`]),
      image: item.artworkUrl || null,
      imageKind: "art",
      glyph: initial(title),
      badge: null,
      target: { type: "track", item, playlist },
    });
  }
  return sortByScore(hits);
}

// ── History (results arrive from the backend's own search) ───────────────

/** History rows rank a little below live and saved things with the same title. */
const HISTORY_PENALTY = 8;
/** The backend matched on something we do not score (e.g. part of a URL). */
const HISTORY_FLOOR = 12;

export function historyHits(
  pages: readonly PageVisit[],
  plays: readonly MediaPlay[],
  q: ParsedQuery,
): SearchHit[] {
  if (q.flags.size > 0) return [];
  const hits: SearchHit[] = [];
  // Rows arrive newest first; one result per address is enough for search —
  // the History section shows every visit.
  const seenPages = new Set<string>();
  const seenPlays = new Set<string>();

  for (const visit of pages) {
    if (seenPages.has(visit.url)) continue;
    seenPages.add(visit.url);
    const host = hostOf(visit.url);
    if (q.site && !hostMatchesSite(host, q.site)) continue;
    const base = scoreFields(
      [field(visit.title, 1), field(host, 0.7), field(visit.url, 0.3)],
      q.terms,
    );
    const title = visit.title.trim() || host || visit.url;
    hits.push({
      key: `page:${visit.id}`,
      group: "history",
      score: Math.max(HISTORY_FLOOR, base - HISTORY_PENALTY),
      title,
      subtitle: joinMeta([host, visit.browserName]),
      image: visit.faviconUrl || faviconFromUrl(visit.url),
      imageKind: "icon",
      glyph: initial(host ?? title),
      badge: null,
      target: { type: "page", visit },
    });
  }

  for (const play of plays) {
    if (seenPlays.has(play.url)) continue;
    seenPlays.add(play.url);
    const host = hostOf(play.url);
    if (q.site && !hostMatchesSite(host, q.site)) continue;
    const base = scoreFields(
      [
        field(play.title, 1),
        field(play.artist, 0.85),
        field(play.pageTitle, 0.7),
        field(play.album, 0.6),
        field(host, 0.5),
      ],
      q.terms,
    );
    const title = play.title.trim() || play.pageTitle.trim() || host || play.url;
    hits.push({
      key: `play:${play.id}`,
      group: "history",
      score: Math.max(HISTORY_FLOOR, base - HISTORY_PENALTY),
      title,
      subtitle: joinMeta([play.artist, host, "played"]),
      image: play.artworkUrl || null,
      imageKind: "art",
      glyph: initial(title),
      badge: null,
      target: { type: "play", play },
    });
  }
  return sortByScore(hits);
}

// ── Commands ─────────────────────────────────────────────────────────────

export type CommandSpec = { id: CommandId; label: string; keywords: string; glyph: string };

export const COMMANDS: readonly CommandSpec[] = [
  { id: "go:live", label: "Go to Live", keywords: "tabs browsers windows overview now playing", glyph: "◉" },
  { id: "go:history", label: "Go to History", keywords: "visited pages played media recent", glyph: "↺" },
  { id: "go:bookmarks", label: "Go to Bookmarks", keywords: "saved vault collections", glyph: "★" },
  { id: "go:playlists", label: "Go to Playlists", keywords: "music tracks player", glyph: "♪" },
  { id: "sync", label: "Sync browsers", keywords: "refresh reload resend reconnect", glyph: "⟳" },
  { id: "pause-all", label: "Pause all media", keywords: "stop silence everything", glyph: "❚❚" },
  { id: "mute-all", label: "Mute all tabs", keywords: "silence sound quiet", glyph: "✕" },
  { id: "reset-volumes", label: "Reset all volumes", keywords: "100 boost default", glyph: "◎" },
];

const COMMAND_FIELDS = COMMANDS.map((c) => [field(c.label, 1), field(c.keywords, 0.6)]);

export function commandHit(spec: CommandSpec, score: number): SearchHit {
  return {
    key: `command:${spec.id}`,
    group: "commands",
    score,
    title: spec.label,
    subtitle: "",
    image: null,
    imageKind: "icon",
    glyph: spec.glyph,
    badge: null,
    target: { type: "command", command: spec.id },
  };
}

export function searchCommands(q: ParsedQuery): SearchHit[] {
  if (q.site || q.flags.size > 0) return [];
  // One stray letter matches half the labels; wait for a real word.
  if (q.terms.join("").length < 2) return [];
  const hits: SearchHit[] = [];
  COMMANDS.forEach((spec, i) => {
    const score = scoreFields(COMMAND_FIELDS[i], q.terms);
    // Commands only surface on a strong match — "go" or "sync", not a stray "a".
    if (score >= 40) hits.push(commandHit(spec, score));
  });
  return sortByScore(hits);
}
