import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { historyApi } from "../api";
import {
  HISTORY_EVENTS,
  type HistoryCursor,
  type HistoryEntry,
  type HistoryKind,
} from "../types";

const PAGE_SIZE = 50;
/** Backend page cap — a refresh re-reads at most this many rows. */
const MAX_PAGE = 200;
const SEARCH_DEBOUNCE_MS = 200;

export interface HistoryListApi<T> {
  items: T[];
  /** First page (or a new search) is loading. */
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  remove: (ids: number[]) => Promise<void>;
  /** Remove every row of this kind that started in `[fromMs, toMs)`. */
  clearRange: (fromMs: number, toMs: number) => Promise<void>;
}

interface ListState<T> {
  items: T[];
  next: HistoryCursor | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

function errorText(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "Something went wrong";
}

/**
 * One paginated, searchable, live history list.
 *
 * The backend is the source of truth and is re-queried rather than patched:
 * on `history://changed` the rows already on screen are re-read in one query,
 * so open entries tick forward and new ones appear at the top without the list
 * jumping. Every request carries a sequence number and only the latest one may
 * land, so a slow response can never overwrite a newer one.
 */
export function useHistoryList<K extends HistoryKind>(
  kind: K,
  search: string,
): HistoryListApi<HistoryEntry<K>> {
  type T = HistoryEntry<K>;
  const [state, setState] = useState<ListState<T>>({
    items: [],
    next: null,
    loading: true,
    loadingMore: false,
    error: null,
  });
  const query = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

  const seq = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  /** (Re)read the newest `limit` rows, replacing the list. */
  const fetchHead = useCallback(
    (limit: number) => {
      const id = ++seq.current;
      historyApi
        .query(kind, { search: query || null, limit })
        .then((page) => {
          if (id !== seq.current) return;
          setState({
            items: page.items,
            next: page.next ?? null,
            loading: false,
            loadingMore: false,
            error: null,
          });
        })
        .catch((err: unknown) => {
          if (id !== seq.current) return;
          setState((s) => ({ ...s, loading: false, loadingMore: false, error: errorText(err) }));
        });
    },
    [kind, query],
  );

  // New list or new search: start from an empty, loading list.
  useEffect(() => {
    setState({ items: [], next: null, loading: true, loadingMore: false, error: null });
    fetchHead(PAGE_SIZE);
  }, [fetchHead]);

  // Live updates: re-read what is on screen.
  useEffect(() => {
    let alive = true;
    const unlisten = listen(HISTORY_EVENTS.changed, () => {
      if (!alive) return;
      const shown = stateRef.current.items.length;
      fetchHead(Math.min(MAX_PAGE, Math.max(PAGE_SIZE, shown)));
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, [fetchHead]);

  const loadMore = useCallback(() => {
    const { next, loading, loadingMore } = stateRef.current;
    if (!next || loading || loadingMore) return;
    const id = ++seq.current;
    setState((s) => ({ ...s, loadingMore: true }));
    historyApi
      .query(kind, { search: query || null, before: next, limit: PAGE_SIZE })
      .then((page) => {
        if (id !== seq.current) return;
        setState((s) => ({
          ...s,
          items: [...s.items, ...page.items],
          next: page.next ?? null,
          loadingMore: false,
          error: null,
        }));
      })
      .catch((err: unknown) => {
        if (id !== seq.current) return;
        setState((s) => ({ ...s, loadingMore: false, error: errorText(err) }));
      });
  }, [kind, query]);

  // Deletes are optimistic; the `changed` event that follows re-syncs the
  // list either way, and a failure re-reads it immediately.
  const removeWhere = useCallback(
    async (drop: (item: T) => boolean, request: () => Promise<number>) => {
      setState((s) => ({ ...s, items: s.items.filter((item) => !drop(item)) }));
      try {
        await request();
      } catch (err) {
        setState((s) => ({ ...s, error: errorText(err) }));
        fetchHead(Math.min(MAX_PAGE, Math.max(PAGE_SIZE, stateRef.current.items.length)));
      }
    },
    [fetchHead],
  );

  const remove = useCallback(
    (ids: number[]) => {
      const set = new Set(ids);
      return removeWhere((item) => set.has(item.id), () => historyApi.delete(kind, ids));
    },
    [kind, removeWhere],
  );

  const clearRange = useCallback(
    (fromMs: number, toMs: number) =>
      removeWhere(
        (item) => item.startedAtMs >= fromMs && item.startedAtMs < toMs,
        () => historyApi.clear({ kind, fromMs, toMs }),
      ),
    [kind, removeWhere],
  );

  return {
    items: state.items,
    loading: state.loading,
    loadingMore: state.loadingMore,
    hasMore: state.next != null,
    error: state.error,
    loadMore,
    remove,
    clearRange,
  };
}

function useDebouncedValue<V>(value: V, delayMs: number): V {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
