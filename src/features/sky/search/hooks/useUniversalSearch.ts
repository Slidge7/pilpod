import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { historyApi, type MediaPlay, type PageVisit } from "../../../history";
import { useLiveBrowsers, usePlayer, useVaultData } from "../../data/SkyData";
import {
  historyHits,
  indexBookmarks,
  indexPlaylists,
  indexTabs,
  searchBookmarks,
  searchCommands,
  searchPlaylists,
  searchTabs,
} from "../lib/providers";
import {
  effectiveScope,
  isEmptyQuery,
  parseQuery,
  type ParsedQuery,
  type SearchScope,
} from "../lib/query";
import { buildGroups, flattenGroups } from "../lib/rank";
import type { ResultGroup, ResultGroupId, SearchHit } from "../lib/types";

/** Wait this long after typing stops before asking the history database. */
const HISTORY_DEBOUNCE_MS = 140;
/** Rows of each history kind fetched per query. */
const HISTORY_LIMIT = 12;

type HistoryResults = {
  /** The query these rows answer; stale rows are never shown for a new query. */
  key: string;
  pages: PageVisit[];
  plays: MediaPlay[];
};

export type UniversalSearch = {
  query: ParsedQuery;
  scope: SearchScope;
  empty: boolean;
  groups: ResultGroup[];
  /** Rows in display order, for keyboard navigation. */
  flat: SearchHit[];
  /** Matches per group before truncation, for the scope chips. */
  counts: Partial<Record<ResultGroupId, number>>;
  historyPending: boolean;
};

function wantsHistory(q: ParsedQuery, scope: SearchScope): boolean {
  return (
    (scope === "all" || scope === "history") &&
    q.flags.size === 0 &&
    q.text.trim().length > 0
  );
}

/**
 * Search everything Sky knows: live tabs, the vault and history.
 *
 * Mounted only while the results panel is open, so a closed panel costs
 * nothing. Tabs and the vault are searched in memory against indexes rebuilt
 * only when their data changes; history is asked of the backend (it can hold
 * far more rows than belong in memory), debounced and sequence-guarded so a
 * slow answer for an old query never replaces a newer one.
 */
export function useUniversalSearch(input: string, picked: SearchScope): UniversalSearch {
  const { browsers } = useLiveBrowsers();
  const { vault } = useVaultData();
  const { player } = usePlayer();

  // Typing stays instant; React re-ranks behind it at lower priority.
  const deferred = useDeferredValue(input);
  const query = useMemo(() => parseQuery(deferred), [deferred]);
  const scope = effectiveScope(query, picked);
  const empty = isEmptyQuery(query);

  const tabDocs = useMemo(() => indexTabs(browsers), [browsers]);
  const bookmarkDocs = useMemo(() => indexBookmarks(vault), [vault]);
  const playlistIndex = useMemo(() => indexPlaylists(vault), [vault]);
  const activePlaylistId = player.active ? (player.playlistId ?? null) : null;

  // ── History (async) ─────────────────────────────────────────────────
  const historyKey = wantsHistory(query, scope) ? `${query.text}\u0000${query.site ?? ""}` : "";
  const [history, setHistory] = useState<HistoryResults>({ key: "", pages: [], plays: [] });

  useEffect(() => {
    if (!historyKey) return;
    let cancelled = false;
    const search = query.text;
    const timer = window.setTimeout(() => {
      Promise.all([
        historyApi.queryPages({ search, limit: HISTORY_LIMIT }),
        historyApi.queryMedia({ search, limit: HISTORY_LIMIT }),
      ])
        .then(([pages, plays]) => {
          if (!cancelled) setHistory({ key: historyKey, pages: pages.items, plays: plays.items });
        })
        .catch(() => {
          // History unavailable or failing: search simply has no history rows.
          if (!cancelled) setHistory({ key: historyKey, pages: [], plays: [] });
        });
    }, HISTORY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `historyKey` already encodes `query.text`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey]);

  const historyFresh = historyKey !== "" && history.key === historyKey;

  // ── Rank ────────────────────────────────────────────────────────────
  const tabHits = useMemo(() => (empty ? [] : searchTabs(tabDocs, query)), [empty, tabDocs, query]);
  const vaultHits = useMemo(
    () =>
      empty
        ? { bookmarks: [], playlists: [] }
        : {
            bookmarks: searchBookmarks(bookmarkDocs, query),
            playlists: searchPlaylists(playlistIndex, query, activePlaylistId),
          },
    [empty, bookmarkDocs, playlistIndex, query, activePlaylistId],
  );
  const historyRows = useMemo(
    () => (historyFresh ? historyHits(history.pages, history.plays, query) : []),
    [historyFresh, history, query],
  );
  const commandHits = useMemo(() => searchCommands(query), [query]);

  return useMemo(() => {
    const byGroup: Partial<Record<ResultGroupId, SearchHit[]>> = {
      commands: commandHits,
      tabs: tabHits,
      playlists: vaultHits.playlists,
      bookmarks: vaultHits.bookmarks,
      history: historyRows,
    };
    const groups = buildGroups(byGroup, scope);
    const counts: Partial<Record<ResultGroupId, number>> = {};
    for (const [id, hits] of Object.entries(byGroup)) {
      counts[id as ResultGroupId] = hits?.length ?? 0;
    }
    return {
      query,
      scope,
      empty,
      groups,
      flat: flattenGroups(groups),
      counts,
      historyPending: historyKey !== "" && !historyFresh,
    };
  }, [commandHits, tabHits, vaultHits, historyRows, scope, query, empty, historyKey, historyFresh]);
}
