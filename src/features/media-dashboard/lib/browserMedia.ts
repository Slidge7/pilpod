import type { BrowserTab, TabMedia } from "../../../types/media";

/** Show idle hint on media tabs when user inactive longer than this. */
export const USER_IDLE_WARN_MS = 300_000;

/** Tab lifecycle badge label (sleeping / crashed / loading). */
export function tabStateBadge(tabState?: string): string | null {
  const s = (tabState ?? "").toLowerCase();
  if (s === "sleeping") return "💤";
  if (s === "crashed") return "⚠️";
  if (s === "loading") return "⏳";
  return null;
}

/** True when the tab has active media that is currently playing. */
export function isTabPlaying(t: BrowserTab): boolean {
  return t.media?.playbackState === "playing";
}

/** True when the tab has any active media (playing or paused). */
export function tabHasMedia(t: BrowserTab): boolean {
  if (t.media == null) return false;
  const state = (t.media.playbackState ?? "").toLowerCase();
  if (state === "playing" || state === "paused") return true;
  // MediaSession / element detected but playback state not resolved yet.
  if ((t.media.title?.trim() ?? "").length > 0) return true;
  if ((t.media.artist?.trim() ?? "").length > 0) return true;
  return (t.media.duration ?? 0) > 0;
}

/** Stable pending key for any browser tab row. */
export function tabRowKey(t: BrowserTab): string {
  return `tab:${t.browserId ?? ""}:${t.tabId}`;
}

/** Trim and lower-case a tab search query. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** True when a tab matches a non-empty search query (title, URL, or media meta). */
export function tabMatchesSearch(tab: BrowserTab, query: string): boolean {
  const q = normalizeSearchQuery(query);
  if (!q) return true;
  const fields = [
    tab.title,
    tab.url,
    tab.media?.title,
    tab.media?.artist,
    tab.media?.album,
  ];
  return fields.some((value) => (value ?? "").toLowerCase().includes(q));
}

/** Normalized hostname for site grouping (without leading www.). */
export function tabSiteHost(tab: BrowserTab): string | null {
  const raw = tab.url?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export type SearchTabMatch = {
  browserId: string;
  browserDisplayName: string;
  tab: BrowserTab;
};

export type SearchTagOption = {
  key: string;
  label: string;
  count: number;
};

/** Flat list of tabs that match the text query across all browsers. */
export function collectTextSearchMatches(
  browsers: ReadonlyArray<{ id: string; displayName: string; tabs: BrowserTab[] }>,
  query: string,
): SearchTabMatch[] {
  const q = normalizeSearchQuery(query);
  if (!q) return [];

  const matches: SearchTabMatch[] = [];
  for (const browser of browsers) {
    for (const tab of browser.tabs) {
      if (tabMatchesSearch(tab, q)) {
        matches.push({
          browserId: browser.id,
          browserDisplayName: browser.displayName,
          tab,
        });
      }
    }
  }
  return matches;
}

function sortTagOptions(options: SearchTagOption[]): SearchTagOption[] {
  return [...options].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

/** Site and browser tags derived from text matches, minus excluded entries. */
export function deriveSearchTagOptions(
  matches: SearchTabMatch[],
  excludedSites: ReadonlySet<string>,
  excludedBrowsers: ReadonlySet<string>,
): { sites: SearchTagOption[]; browsers: SearchTagOption[] } {
  const siteCounts = new Map<string, { label: string; count: number }>();
  const browserCounts = new Map<string, { label: string; count: number }>();

  for (const match of matches) {
    if (excludedBrowsers.has(match.browserId)) continue;

    const site = tabSiteHost(match.tab);
    if (site && !excludedSites.has(site)) {
      const existing = siteCounts.get(site);
      if (existing) existing.count += 1;
      else siteCounts.set(site, { label: site, count: 1 });
    }

    const browserExisting = browserCounts.get(match.browserId);
    if (browserExisting) browserExisting.count += 1;
    else {
      browserCounts.set(match.browserId, {
        label: match.browserDisplayName,
        count: 1,
      });
    }
  }

  const sites = sortTagOptions(
    [...siteCounts.entries()].map(([key, { label, count }]) => ({
      key,
      label,
      count,
    })),
  );
  const browsers = sortTagOptions(
    [...browserCounts.entries()].map(([key, { label, count }]) => ({
      key,
      label,
      count,
    })),
  );

  return { sites, browsers };
}

/** Apply exclude + include tag filters on top of text matches. */
export function applySearchTagFilters(
  matches: SearchTabMatch[],
  excludedSites: ReadonlySet<string>,
  excludedBrowsers: ReadonlySet<string>,
  selectedSites: ReadonlySet<string>,
  selectedBrowsers: ReadonlySet<string>,
): SearchTabMatch[] {
  const siteFilterActive = selectedSites.size > 0;
  const browserFilterActive = selectedBrowsers.size > 0;

  return matches.filter((match) => {
    if (excludedBrowsers.has(match.browserId)) return false;

    const site = tabSiteHost(match.tab);
    if (site && excludedSites.has(site)) return false;

    if (browserFilterActive && !selectedBrowsers.has(match.browserId)) {
      return false;
    }
    if (siteFilterActive) {
      if (!site || !selectedSites.has(site)) return false;
    }

    return true;
  });
}

/** Group filtered matches back into per-browser buckets for rendering. */
export function groupSearchMatchesByBrowser(
  browsers: ReadonlyArray<{ id: string; displayName: string; running: boolean; extensionInstalled: boolean; extensionConnected: boolean; lastSyncSecs: number | null }>,
  matches: SearchTabMatch[],
): Array<{ id: string; displayName: string; running: boolean; extensionInstalled: boolean; extensionConnected: boolean; lastSyncSecs: number | null; tabs: BrowserTab[]; tabCount: number }> {
  const browserById = new Map(browsers.map((b) => [b.id, b]));
  const tabsByBrowser = new Map<string, BrowserTab[]>();

  for (const match of matches) {
    if (!browserById.has(match.browserId)) continue;
    const list = tabsByBrowser.get(match.browserId);
    if (list) list.push(match.tab);
    else tabsByBrowser.set(match.browserId, [match.tab]);
  }

  const grouped: Array<{
    id: string;
    displayName: string;
    running: boolean;
    extensionInstalled: boolean;
    extensionConnected: boolean;
    lastSyncSecs: number | null;
    tabs: BrowserTab[];
    tabCount: number;
  }> = [];

  for (const browser of browsers) {
    const tabs = tabsByBrowser.get(browser.id);
    if (!tabs?.length) continue;
    grouped.push({
      id: browser.id,
      displayName: browser.displayName,
      running: browser.running,
      extensionInstalled: browser.extensionInstalled,
      extensionConnected: browser.extensionConnected,
      lastSyncSecs: browser.lastSyncSecs,
      tabs,
      tabCount: tabs.length,
    });
  }

  return grouped;
}

export function abbreviatedUrl(url: string, max = 52): string {
  const u = url.trim();
  if (u.length <= max) return u;
  return `${u.slice(0, Math.max(0, max - 1))}…`;
}

/** Best-effort favicon URL via Google's favicon service. */
export function faviconFromUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(u.hostname)}`;
  } catch {
    return null;
  }
}

/** Format seconds as MM:SS / H:MM:SS. */
export function formatMediaSeconds(secs: number): string {
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Artist field from tab media. */
export function mediaArtist(m: TabMedia): string | null {
  return m.artist?.trim() || null;
}

/** Time label ("1:23 / 4:56") from tab media, if available. */
export function mediaTimeLabel(m: TabMedia): string | null {
  const dur = m.duration != null && m.duration > 0 ? m.duration : null;
  if (dur == null) return null;
  const pos = m.currentTime != null && m.currentTime >= 0 ? m.currentTime : 0;
  return `${formatMediaSeconds(pos)} / ${formatMediaSeconds(dur)}`;
}
