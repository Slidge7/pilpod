import { invoke } from "@tauri-apps/api/core";
import type {
  HistoryEntry,
  HistoryKind,
  HistoryPage,
  HistoryQuery,
  HistorySettings,
  MediaPlay,
  PageVisit,
} from "./types";

/**
 * The history command surface, typed once. Components and hooks call these —
 * never `invoke` with a command-name string — so a rename on the Rust side is
 * a one-file change here.
 */
export const historyApi = {
  queryPages: (query: HistoryQuery) =>
    invoke<HistoryPage<PageVisit>>("history_query_pages", { query }),

  queryMedia: (query: HistoryQuery) =>
    invoke<HistoryPage<MediaPlay>>("history_query_media", { query }),

  query<K extends HistoryKind>(kind: K, query: HistoryQuery) {
    return (
      kind === "pages" ? historyApi.queryPages(query) : historyApi.queryMedia(query)
    ) as Promise<HistoryPage<HistoryEntry<K>>>;
  },

  delete: (kind: HistoryKind, ids: number[]) =>
    invoke<number>("history_delete", { kind, ids }),

  /** Remove rows that started in `[fromMs, toMs)`; omitted bounds are open. */
  clear: (range: { kind?: HistoryKind | null; fromMs?: number | null; toMs?: number | null }) =>
    invoke<number>("history_clear", {
      kind: range.kind ?? null,
      fromMs: range.fromMs ?? null,
      toMs: range.toMs ?? null,
    }),

  getSettings: () => invoke<HistorySettings>("history_get_settings"),

  setSettings: (settings: HistorySettings) =>
    invoke<HistorySettings>("history_set_settings", { settings }),

  /** Focus a live tab already on this page, else open it. */
  open: (url: string) => invoke<"focused" | "launched">("history_open", { url }),
};
