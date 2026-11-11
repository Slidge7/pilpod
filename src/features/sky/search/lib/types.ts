import type { BrowserTab } from "../../../../types/media";
import type { MediaPlay, PageVisit } from "../../../history";
import type { Bookmark, MediaItem, Playlist } from "../../../vault";
import type { SectionId, SettingsPageId } from "../../navigation/route";

/**
 * Search results as data. Providers build these; the UI renders them and a
 * single executor (`useHitActions`) turns a hit's `target` into an action.
 * Keeping actions out of the hits keeps the providers pure and testable.
 */

export type ResultGroupId = "commands" | "tabs" | "playlists" | "bookmarks" | "history";

export type CommandId =
  | `go:${SectionId}`
  | "sync"
  | "pause-all"
  | "mute-all"
  | "reset-volumes"
  | "toggle-theme"
  | `settings:${SettingsPageId}`;

export type SearchTarget =
  | { type: "tab"; browserId: string; browserName: string; tab: BrowserTab }
  | { type: "bookmark"; bookmark: Bookmark }
  | { type: "playlist"; playlist: Playlist }
  | { type: "track"; item: MediaItem; playlist: Playlist }
  | { type: "page"; visit: PageVisit }
  | { type: "play"; play: MediaPlay }
  | { type: "command"; command: CommandId };

/** A small state shown beside a result. */
export type HitBadge = "playing" | "paused" | "audible" | "pinned" | "playlist-live";

export type SearchHit = {
  /** Unique across all groups — the React key and the listbox option id. */
  key: string;
  group: ResultGroupId;
  /** 0–100+, comparable across groups. */
  score: number;
  title: string;
  subtitle: string;
  /** Artwork or favicon; `null` falls back to `glyph`. */
  image: string | null;
  /** Initial or symbol for the fallback tile. */
  glyph: string;
  /** Square artwork (tracks, media) vs a small icon (favicons). */
  imageKind: "icon" | "art";
  badge: HitBadge | null;
  target: SearchTarget;
};

export type ResultGroup = {
  id: ResultGroupId;
  label: string;
  hits: SearchHit[];
  /** Matches before truncation — "See all 42". */
  total: number;
};
