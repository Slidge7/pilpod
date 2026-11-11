import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { BrowserTab } from "../../../../types/media";
import { collectActiveMediaTabs } from "../../../media-dashboard";
import { useLiveBrowsers, usePlayer } from "../../data/GodModeData";
import { useSectionIntent } from "../../navigation/Navigation";
import { buildRailEntries, buildSections, isNarrowingQuery } from "./lib/overview";
import { DEFAULT_QUERY, type OverviewQuery, type TabFilter } from "./types";

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
 * The Live section's view model: the user's query (filter chips, filter box,
 * selected browser) and everything derived from it. Data comes from the
 * shared providers; this hook owns only the view.
 */
export function useLiveOverview() {
  const { browsers, browserAudio, stats, controls } = useLiveBrowsers();
  const { player } = usePlayer();

  const [query, setQuery] = useState<OverviewQuery>(DEFAULT_QUERY);
  // Hundreds of cards re-filter on every keystroke; deferring keeps the input
  // responsive while React renders the grid behind it.
  const viewQuery = useDeferredValue(query);

  const rail = useMemo(() => buildRailEntries(browsers), [browsers]);
  const sections = useMemo(() => buildSections(browsers, viewQuery), [browsers, viewQuery]);

  const narrowing = isNarrowingQuery(viewQuery);
  const nowPlaying = useMemo(() => {
    // While a filter is active the sections already *are* the results.
    if (narrowing) return [];
    const all = collectActiveMediaTabs(browsers);
    return viewQuery.browserId === null
      ? all
      : all.filter((m) => m.browserId === viewQuery.browserId);
  }, [browsers, narrowing, viewQuery.browserId]);

  /** Tabs shown after the query — the toolbar's "12 of 140". */
  const shownTabs = useMemo(
    () => sections.reduce((n, s) => n + s.shownTabs, 0),
    [sections],
  );

  /** `browserId:tabId` of the tab hosting the playlist session, if any. */
  const playerTabKey =
    player.active && player.browserId && player.tabId != null
      ? `${player.browserId}:${player.tabId}`
      : null;

  const { focusTab, toggleTab, setTabMuted, reloadTab, closeTab } = controls;
  const actions = useMemo<TabCardActions>(
    () => ({
      focus: (tab, browserId, browserName) => void focusTab(tab, browserId, browserName),
      togglePlay: toggleTab,
      setMuted: setTabMuted,
      reload: (tab, browserId) => void reloadTab(tab, browserId),
      close: (tab, browserId) => void closeTab(tab, browserId),
    }),
    [focusTab, toggleTab, setTabMuted, reloadTab, closeTab],
  );

  const setFilter = useCallback((filter: TabFilter) => setQuery((q) => ({ ...q, filter })), []);
  const setSearch = useCallback((search: string) => setQuery((q) => ({ ...q, search })), []);
  const selectBrowser = useCallback(
    (browserId: string | null) => setQuery((q) => ({ ...q, browserId })),
    [],
  );
  const reset = useCallback(() => setQuery(DEFAULT_QUERY), []);

  useSectionIntent("live", (intent) =>
    setQuery((q) => ({
      ...q,
      filter: "all",
      search: intent.search ?? q.search,
      browserId: intent.browserId !== undefined ? intent.browserId : q.browserId,
    })),
  );

  return {
    browserAudio,
    stats,
    query,
    rail,
    sections,
    nowPlaying,
    narrowing,
    shownTabs,
    playerTabKey,
    actions,
    pendingKeys: controls.pendingKeys,
    hasBrowsers: browsers.length > 0,
    setFilter,
    setSearch,
    selectBrowser,
    reset,
  };
}
