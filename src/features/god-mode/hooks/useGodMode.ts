import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BrowserTab } from "../../../types/media";
import {
  collectActiveMediaTabs,
  useBrowserControls,
  useBrowsers,
} from "../../media-dashboard";
import { usePlaylistPlayer } from "../../playlist-player";
import {
  buildRailEntries,
  buildSections,
  isNarrowingQuery,
  summarize,
} from "../lib/overview";
import { DEFAULT_QUERY, type OverviewQuery, type TabFilter } from "../types";
import { useWidgetSnapshot } from "./useWidgetSnapshot";

/**
 * Every action a tab card can take. One stable object, built from the shared
 * `useBrowserControls` callbacks, so memoized cards are not re-rendered just
 * because the page re-rendered.
 */
export type TabCardActions = {
  focus: (tab: BrowserTab, browserId: string, browserName: string) => void;
  togglePlay: (tab: BrowserTab, browserId: string) => void;
  setMuted: (tab: BrowserTab, browserId: string, muted: boolean) => void;
  reload: (tab: BrowserTab, browserId: string) => void;
  close: (tab: BrowserTab, browserId: string) => void;
};

/**
 * Everything the God Mode page renders, in one place.
 *
 * Owns no data of its own: browsers, the playlist session and the widget all
 * come from the same Rust broadcasts the dashboard listens to. What this hook
 * adds is the view — the query the user is narrowing by, and the derived
 * model (stats, rail, sections) computed from it.
 */
export function useGodMode() {
  const { browsers, browserAudio } = useBrowsers();
  const controls = useBrowserControls(browsers);
  const { player } = usePlaylistPlayer();
  const widget = useWidgetSnapshot();

  const [query, setQuery] = useState<OverviewQuery>(DEFAULT_QUERY);
  // Hundreds of cards re-filter on every keystroke; deferring keeps the input
  // responsive while React renders the grid behind it.
  const viewQuery = useDeferredValue(query);

  const stats = useMemo(() => summarize(browsers), [browsers]);
  const rail = useMemo(() => buildRailEntries(browsers), [browsers]);
  const sections = useMemo(
    () => buildSections(browsers, viewQuery),
    [browsers, viewQuery],
  );

  const narrowing = isNarrowingQuery(viewQuery);
  const nowPlaying = useMemo(() => {
    // The browser sections already *are* the filtered results; repeating the
    // playing tabs above them would only push the results down.
    if (narrowing) return [];
    const all = collectActiveMediaTabs(browsers);
    return viewQuery.browserId === null
      ? all
      : all.filter((m) => m.browserId === viewQuery.browserId);
  }, [browsers, narrowing, viewQuery.browserId]);

  /** `browserId:tabId` of the tab hosting the playlist session, if any. */
  const playerTabKey =
    player.active && player.browserId && player.tabId != null
      ? `${player.browserId}:${player.tabId}`
      : null;

  const { focusTab, toggleTab, setTabMuted, reloadTab, closeTab, setError } =
    controls;
  const actions = useMemo<TabCardActions>(
    () => ({
      focus: (tab, browserId, browserName) =>
        void focusTab(tab, browserId, browserName),
      togglePlay: toggleTab,
      setMuted: setTabMuted,
      reload: (tab, browserId) => void reloadTab(tab, browserId),
      close: (tab, browserId) => void closeTab(tab, browserId),
    }),
    [focusTab, toggleTab, setTabMuted, reloadTab, closeTab],
  );

  const setFilter = useCallback(
    (filter: TabFilter) => setQuery((q) => ({ ...q, filter })),
    [],
  );
  const setSearch = useCallback(
    (search: string) => setQuery((q) => ({ ...q, search })),
    [],
  );
  const selectBrowser = useCallback(
    (browserId: string | null) => setQuery((q) => ({ ...q, browserId })),
    [],
  );

  const syncAll = useCallback(() => {
    invoke("request_browser_sync").catch((err: unknown) =>
      setError(String(err)),
    );
  }, [setError]);
  const clearError = useCallback(() => setError(null), [setError]);

  return {
    browserAudio,
    player,
    widget,
    query,
    stats,
    rail,
    sections,
    nowPlaying,
    narrowing,
    playerTabKey,
    actions,
    pendingKeys: controls.pendingKeys,
    error: controls.error,
    clearError,
    setFilter,
    setSearch,
    selectBrowser,
    syncAll,
  };
}

export type GodModeState = ReturnType<typeof useGodMode>;
