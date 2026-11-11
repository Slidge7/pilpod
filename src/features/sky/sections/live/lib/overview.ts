import type { BrowserTab, DetectedBrowser } from "../../../../../types/media";
import { groupTabsByWindow } from "../../../../../shared/groupTabsByWindow";
import {
  browserDisplayLabel,
  isTabPlaying,
  resolveBrowserStatus,
  tabIsLinkIdentifiedMedia,
} from "../../../../media-dashboard";
import { visibleTabs, windowCount } from "../../../data/browserStats";
import { scoreFields } from "../../../search/lib/score";
import { parseQuery } from "../../../search/lib/query";
import { fold, hostMatchesSite, hostOf } from "../../../search/lib/text";
import type {
  BrowserRailEntry,
  BrowserSection,
  OverviewQuery,
  TabFilter,
} from "../types";

export { summarize, visibleTabs } from "../../../data/browserStats";

/**
 * The Sky view model, as pure functions over the browser stream.
 *
 * Nothing here knows about React or Tauri, so every rule the page applies —
 * what counts as media, what a locked browser may show, when an empty section
 * is still worth a heading — is unit-tested in isolation.
 */

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

/**
 * The Live filter box speaks the same language as the universal search —
 * every word must match, accents and case ignored, `site:` and `is:` work —
 * so a query moved from one to the other ("show in Sky") finds the same
 * tabs.
 */
export function tabMatcher(search: string): (tab: BrowserTab) => boolean {
  const q = parseQuery(search);
  if (q.terms.length === 0 && !q.site && q.flags.size === 0) return () => true;
  return (tab) => {
    const host = hostOf(tab.url);
    if (q.site && !hostMatchesSite(host, q.site)) return false;
    for (const flag of q.flags) {
      if (flag === "playing" && !isTabPlaying(tab)) return false;
      if (flag === "audible" && tab.audible !== true) return false;
      if (flag === "pinned" && tab.pinned !== true) return false;
      if (flag === "media" && !tabIsLinkIdentifiedMedia(tab)) return false;
    }
    return (
      scoreFields(
        [
          { text: fold(tab.title), weight: 1 },
          { text: fold(tab.media?.title), weight: 1 },
          { text: fold(tab.media?.artist), weight: 1 },
          { text: fold(tab.media?.album), weight: 1 },
          { text: fold(host), weight: 1 },
          { text: fold(tab.url), weight: 1 },
        ],
        q.terms,
      ) > 0
    );
  };
}

/** True when the query hides anything — empty sections are then dropped. */
export function isNarrowingQuery(query: OverviewQuery): boolean {
  return query.filter !== "all" || query.search.trim().length > 0;
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
  const matches = tabMatcher(query.search);
  const sections: BrowserSection[] = [];

  for (const browser of browsers) {
    if (query.browserId !== null && browser.id !== query.browserId) continue;

    const tabs = visibleTabs(browser).filter(
      (tab) => tabPassesFilter(tab, query.filter) && matches(tab),
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
