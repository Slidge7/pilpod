import type { BrowserTab, DetectedBrowser } from "../../../types/media";
import { groupTabsByWindow } from "../../../shared/groupTabsByWindow";
import { isBrowserLocked } from "../../extension-setup";
import {
  browserDisplayLabel,
  isTabPlaying,
  resolveBrowserStatus,
  tabIsLinkIdentifiedMedia,
  tabMatchesSearch,
} from "../../media-dashboard";
import type {
  BrowserRailEntry,
  BrowserSection,
  OverviewQuery,
  OverviewStats,
  TabFilter,
} from "../types";

/**
 * The God Mode view model, as pure functions over the browser stream.
 *
 * Nothing here knows about React or Tauri, so every rule the page applies —
 * what counts as media, what a locked browser may show, when an empty section
 * is still worth a heading — is unit-tested in isolation.
 */

/**
 * The tabs God Mode may show for a browser.
 *
 * A browser whose companion extension is not verified shows none, exactly as
 * on the dashboard: activation is the one gate that unlocks a browser's data,
 * and an overview window is not a way around it.
 */
export function visibleTabs(browser: DetectedBrowser): BrowserTab[] {
  return isBrowserLocked(browser.activationState) ? [] : browser.tabs;
}

export function tabPassesFilter(tab: BrowserTab, filter: TabFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "media":
      return tabIsLinkIdentifiedMedia(tab);
    case "playing":
      return isTabPlaying(tab);
    case "audible":
      return tab.audible === true;
  }
}

/** True when the query hides anything — empty sections are then dropped. */
export function isNarrowingQuery(query: OverviewQuery): boolean {
  return query.filter !== "all" || query.search.trim().length > 0;
}

function windowCount(tabs: readonly BrowserTab[]): number {
  return new Set(tabs.map((t) => t.windowId ?? 0)).size;
}

export function summarize(browsers: readonly DetectedBrowser[]): OverviewStats {
  const stats: OverviewStats = {
    profiles: browsers.length,
    connected: 0,
    windows: 0,
    tabs: 0,
    media: 0,
    playing: 0,
    audible: 0,
  };
  for (const browser of browsers) {
    if (resolveBrowserStatus(browser) === "connected") stats.connected += 1;
    const tabs = visibleTabs(browser);
    stats.windows += windowCount(tabs);
    stats.tabs += tabs.length;
    for (const tab of tabs) {
      if (tabIsLinkIdentifiedMedia(tab)) stats.media += 1;
      if (isTabPlaying(tab)) stats.playing += 1;
      if (tab.audible === true) stats.audible += 1;
    }
  }
  return stats;
}

export function buildRailEntries(
  browsers: readonly DetectedBrowser[],
): BrowserRailEntry[] {
  return browsers.map((browser) => {
    const tabs = visibleTabs(browser);
    const label = browserDisplayLabel(browser);
    return {
      id: browser.id,
      label,
      browserName: label === browser.displayName ? null : browser.displayName,
      iconUrl: browser.iconUrl ?? null,
      status: resolveBrowserStatus(browser),
      windows: windowCount(tabs),
      tabs: tabs.length,
      playing: tabs.filter(isTabPlaying).length,
    };
  });
}

/**
 * Browser sections for the main area, after the query is applied.
 *
 * With nothing narrowing the view every profile keeps its section — a closed
 * or locked browser is still something PilPod knows about, and the section is
 * where it says so. Once a filter or search is active, sections with no
 * matching tab are dropped so the results read as results.
 */
export function buildSections(
  browsers: readonly DetectedBrowser[],
  query: OverviewQuery,
): BrowserSection[] {
  const narrowing = isNarrowingQuery(query);
  const sections: BrowserSection[] = [];

  for (const browser of browsers) {
    if (query.browserId !== null && browser.id !== query.browserId) continue;

    const tabs = visibleTabs(browser).filter(
      (tab) =>
        tabPassesFilter(tab, query.filter) &&
        tabMatchesSearch(tab, query.search),
    );
    if (narrowing && tabs.length === 0) continue;

    sections.push({
      browser,
      label: browserDisplayLabel(browser),
      status: resolveBrowserStatus(browser),
      windows: groupTabsByWindow(tabs),
      shownTabs: tabs.length,
    });
  }

  return sections;
}
