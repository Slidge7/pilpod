/**
 * TypeScript mirror of the Rust history DTOs (serde camelCase, see
 * `src-tauri/src/history/model.rs`). Rust is the source of truth; keep these in
 * sync when the Rust structs change. Optional fields are Rust `Option<T>` with
 * `skip_serializing_if`, so an absent key and `null` are both valid.
 */

/** One stretch of time a tab spent on one URL. */
export interface PageVisit {
  id: number;
  url: string;
  /** Empty only if the page never reported a title. */
  title: string;
  faviconUrl?: string | null;
  browserId: string;
  osBrowserId: string;
  /** Browser / profile label at record time. */
  browserName: string;
  startedAtMs: number;
  /** Absent while the page is still open. */
  endedAtMs?: number | null;
}

/** One piece of media that actually played (10 s or more). */
export interface MediaPlay {
  id: number;
  url: string;
  title: string;
  artist?: string | null;
  album?: string | null;
  artworkUrl?: string | null;
  pageTitle: string;
  durationSecs?: number | null;
  /** Time spent in the `playing` state. */
  playedMs: number;
  browserId: string;
  osBrowserId: string;
  browserName: string;
  startedAtMs: number;
  /** Absent while the media is still loaded in its tab. */
  endedAtMs?: number | null;
}

export type HistoryKind = "pages" | "media";

/** Keyset cursor: the last row of the previous page. */
export interface HistoryCursor {
  startedAtMs: number;
  id: number;
}

export interface HistoryQuery {
  search?: string | null;
  before?: HistoryCursor | null;
  limit?: number;
}

export interface HistoryPage<T> {
  items: T[];
  /** Absent when this page is the last. */
  next?: HistoryCursor | null;
}

export interface HistorySettings {
  /** When false nothing new is recorded; existing history is kept. */
  recording: boolean;
  /** Rows older than this are purged. `0` keeps history forever. */
  retentionDays: number;
}

export type HistoryEntry<K extends HistoryKind> = K extends "pages" ? PageVisit : MediaPlay;

/** Event names (mirror of the Rust `EVT_*` consts). */
export const HISTORY_EVENTS = {
  /** Stored history changed. No payload — re-query what is on screen. */
  changed: "history://changed",
} as const;

/** Typed backend error codes surfaced to the UI. */
export const HISTORY_ERRORS = {
  unavailable: "history_unavailable",
} as const;
