import type { BrowserTab, DetectedBrowser } from "../../../types/media";
import { isBrowserLocked } from "../../extension-setup";
import {
  isTabPlaying,
  resolveBrowserStatus,
  tabIsLinkIdentifiedMedia,
} from "../../media-dashboard";

/**
 * Facts about the live browser stream that more than one part of Sky
 * needs: the sidebar badges, the status panel, the Live section and search
 * all read them. Computed once per browser update by the data provider.
 */

/** Totals across every browser. */
export type OverviewStats = {
  profiles: number;
  connected: number;
  windows: number;
  tabs: number;
  media: number;
  playing: number;
  audible: number;
};

/**
 * The tabs Sky may show for a browser.
 *
 * A browser whose companion extension is not verified shows none, exactly as
 * on the dashboard: activation is the one gate that unlocks a browser's data,
 * and an overview window — or its search — is not a way around it.
 */
export function visibleTabs(browser: DetectedBrowser): BrowserTab[] {
  return isBrowserLocked(browser.activationState) ? [] : browser.tabs;
}

export function windowCount(tabs: readonly BrowserTab[]): number {
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
