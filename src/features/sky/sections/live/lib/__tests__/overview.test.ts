import { describe, expect, it } from "vitest";
import type { BrowserTab, DetectedBrowser } from "../../../../../../types/media";
import { DEFAULT_QUERY } from "../../types";
import {
  buildRailEntries,
  buildSections,
  isNarrowingQuery,
  summarize,
  tabPassesFilter,
  visibleTabs,
} from "../overview";

let nextTabId = 1;

function tab(over: Partial<BrowserTab> = {}): BrowserTab {
  const tabId = nextTabId++;
  return {
    tabId,
    windowId: 1,
    index: tabId,
    url: `https://example.com/${tabId}`,
    title: `Tab ${tabId}`,
    ...over,
  };
}

function browser(over: Partial<DetectedBrowser> = {}): DetectedBrowser {
  const tabs = over.tabs ?? [];
  return {
    id: "chrome-1",
    osBrowserId: "chrome",
    displayName: "Chrome",
    profileLabel: null,
    running: true,
    extensionInstalled: true,
    activationState: "active",
    extensionConnected: true,
    tabCount: tabs.length,
    tabs,
    lastSyncSecs: 0,
    ...over,
  };
}

const playing = () =>
  tab({
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    audible: true,
    media: { playbackState: "playing" },
  });
const paused = () =>
  tab({
    url: "https://open.spotify.com/track/1",
    media: { playbackState: "paused" },
  });

describe("visibleTabs", () => {
  it("shows nothing for a browser whose extension is not verified", () => {
    for (const activationState of [
      "inactive",
      "setupPending",
      "revoked",
      "skipped",
    ] as const) {
      expect(visibleTabs(browser({ activationState, tabs: [tab()] }))).toEqual(
        [],
      );
    }
  });

  it("shows every tab of an active browser", () => {
    const tabs = [tab(), tab()];
    expect(visibleTabs(browser({ tabs }))).toBe(tabs);
  });
});

describe("tabPassesFilter", () => {
  const plain = tab();
  const live = playing();
  const stopped = paused();

  it("narrows by media, playback and sound", () => {
    expect(
      [plain, live, stopped].filter((t) => tabPassesFilter(t, "all")),
    ).toHaveLength(3);
    expect(
      [plain, live, stopped].filter((t) => tabPassesFilter(t, "media")),
    ).toEqual([live, stopped]);
    expect(
      [plain, live, stopped].filter((t) => tabPassesFilter(t, "playing")),
    ).toEqual([live]);
    expect(
      [plain, live, stopped].filter((t) => tabPassesFilter(t, "audible")),
    ).toEqual([live]);
  });
});

describe("summarize", () => {
  it("totals visible tabs and distinct windows across browsers", () => {
    const stats = summarize([
      browser({ tabs: [tab(), playing(), tab({ windowId: 2 })] }),
      browser({ id: "edge-1", extensionConnected: false, tabs: [paused()] }),
      browser({
        id: "brave-1",
        activationState: "inactive",
        tabs: [tab(), tab()],
      }),
    ]);
    expect(stats).toEqual({
      profiles: 3,
      connected: 1,
      windows: 3,
      tabs: 4,
      media: 2,
      playing: 1,
      audible: 1,
    });
  });
});

describe("buildRailEntries", () => {
  it("names a profile row after its profile and keeps the browser name beside it", () => {
    const [entry] = buildRailEntries([
      browser({
        profileLabel: "Work",
        tabs: [playing(), tab({ windowId: 9 })],
      }),
    ]);
    expect(entry).toMatchObject({
      label: "Work",
      browserName: "Chrome",
      status: "connected",
      windows: 2,
      tabs: 2,
      playing: 1,
    });
  });

  it("does not repeat the browser name for a profile-less row", () => {
    expect(buildRailEntries([browser()])[0].browserName).toBeNull();
  });
});

describe("buildSections", () => {
  const chrome = browser({ tabs: [tab(), playing(), tab({ windowId: 2 })] });
  const edge = browser({ id: "edge-1", displayName: "Edge", tabs: [paused()] });
  const closed = browser({ id: "firefox-1", running: false, tabs: [] });

  it("keeps every browser, empty ones included, when nothing narrows the view", () => {
    const sections = buildSections([chrome, edge, closed], DEFAULT_QUERY);
    expect(sections.map((s) => s.browser.id)).toEqual([
      "chrome-1",
      "edge-1",
      "firefox-1",
    ]);
    expect(sections[0].windows.map((w) => w.windowId)).toEqual([1, 2]);
    expect(sections[2]).toMatchObject({ status: "closed", shownTabs: 0 });
  });

  it("drops browsers with no match once a filter is active", () => {
    const sections = buildSections([chrome, edge, closed], {
      ...DEFAULT_QUERY,
      filter: "playing",
    });
    expect(sections.map((s) => s.browser.id)).toEqual(["chrome-1"]);
    expect(sections[0].shownTabs).toBe(1);
  });

  it("searches titles, URLs and media metadata", () => {
    const sections = buildSections([chrome, edge], {
      ...DEFAULT_QUERY,
      search: "spotify",
    });
    expect(sections.map((s) => s.browser.id)).toEqual(["edge-1"]);
  });

  it("restricts to the selected browser", () => {
    const sections = buildSections([chrome, edge], {
      ...DEFAULT_QUERY,
      browserId: "edge-1",
    });
    expect(sections.map((s) => s.browser.id)).toEqual(["edge-1"]);
  });
});

describe("isNarrowingQuery", () => {
  it("ignores whitespace-only searches and the browser selection", () => {
    expect(
      isNarrowingQuery({ ...DEFAULT_QUERY, search: "   ", browserId: "x" }),
    ).toBe(false);
    expect(isNarrowingQuery({ ...DEFAULT_QUERY, filter: "media" })).toBe(true);
  });
});
