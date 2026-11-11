import { describe, expect, it } from "vitest";
import type { BrowserTab, DetectedBrowser } from "../../../../../types/media";
import type { VaultData } from "../../../../vault";
import { parseQuery } from "../query";
import {
  historyHits,
  indexBookmarks,
  indexPlaylists,
  indexTabs,
  searchBookmarks,
  searchCommands,
  searchPlaylists,
  searchTabs,
} from "../providers";
import { buildGroups, flattenGroups } from "../rank";

function tab(over: Partial<BrowserTab>): BrowserTab {
  return { tabId: 1, windowId: 1, index: 0, url: "https://example.com", title: "Example", ...over };
}

function browser(tabs: BrowserTab[], over: Partial<DetectedBrowser> = {}): DetectedBrowser {
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

const vault: VaultData = {
  version: 1,
  collections: [{ id: "c1", name: "Research", createdAtMs: 0, updatedAtMs: 0 }],
  bookmarks: [
    {
      id: "b1",
      url: "https://react.dev/learn",
      normalizedUrl: "react.dev/learn",
      title: "Learn React",
      createdAtMs: 1,
      openCount: 0,
      pinned: false,
      tags: ["docs"],
      collectionIds: ["c1"],
    },
    {
      id: "b2",
      url: "https://jazz.example/radio",
      normalizedUrl: "jazz.example/radio",
      title: "Night radio",
      createdAtMs: 2,
      openCount: 3,
      pinned: true,
      tags: [],
      collectionIds: [],
    },
  ],
  mediaItems: [
    {
      id: "m1",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      normalizedUrl: "youtube.com/watch?v=abcdefghijk",
      pageTitle: "Lofi beats - YouTube",
      mediaTitle: "Lofi beats",
      artist: "Chillhop",
      artworkUrl: "https://img/1.jpg",
      kind: "video",
      addedAtMs: 0,
      playCount: 0,
    },
  ],
  playlists: [
    { id: "p1", name: "Focus", createdAtMs: 0, updatedAtMs: 0, itemIds: ["m1"] },
    { id: "p2", name: "Also lofi", createdAtMs: 0, updatedAtMs: 0, itemIds: ["m1"] },
  ],
};

describe("tabs", () => {
  const playing = tab({
    tabId: 2,
    url: "https://music.youtube.com/watch?v=1",
    title: "Jazz mix",
    audible: true,
    media: { playbackState: "playing", title: "Jazz mix", artist: "Blue Note" },
  });
  const idle = tab({ tabId: 3, url: "https://jazz.example/", title: "Jazz shop" });
  const docs = indexTabs([browser([playing, idle])]);

  it("ranks playing tabs above equally matching idle ones", () => {
    const hits = searchTabs(docs, parseQuery("jazz"));
    expect(hits.map((h) => h.key)).toEqual(["tab:chrome-1:2", "tab:chrome-1:3"]);
    expect(hits[0].badge).toBe("playing");
  });

  it("applies site: and is: filters, alone or with text", () => {
    expect(searchTabs(docs, parseQuery("site:youtube.com"))).toHaveLength(1);
    expect(searchTabs(docs, parseQuery("is:playing"))).toHaveLength(1);
    expect(searchTabs(docs, parseQuery("blue note"))).toHaveLength(1);
  });

  it("never indexes a locked browser", () => {
    const locked = indexTabs([browser([playing], { activationState: "inactive" })]);
    expect(locked).toHaveLength(0);
  });
});

describe("vault", () => {
  it("finds bookmarks by tag and collection name", () => {
    const docs = indexBookmarks(vault);
    expect(searchBookmarks(docs, parseQuery("docs"))[0].key).toBe("bookmark:b1");
    expect(searchBookmarks(docs, parseQuery("research"))[0].key).toBe("bookmark:b1");
    expect(searchBookmarks(docs, parseQuery("is:playing"))).toEqual([]);
  });

  it("finds playlists by name and tracks once, by artist", () => {
    const index = indexPlaylists(vault);
    expect(index.tracks).toHaveLength(1);
    const byArtist = searchPlaylists(index, parseQuery("chillhop"), null);
    expect(byArtist.map((h) => h.key)).toEqual(["track:m1"]);
    const byName = searchPlaylists(index, parseQuery("also"), "p2");
    expect(byName[0].key).toBe("playlist:p2");
    expect(byName[0].badge).toBe("playlist-live");
    expect(byName[0].image).toBe("https://img/1.jpg");
  });
});

describe("history and commands", () => {
  it("keeps backend matches the local scorer cannot explain", () => {
    const hits = historyHits(
      [
        {
          id: 1,
          url: "https://a.example/secret-path",
          title: "Unrelated",
          browserId: "b",
          osBrowserId: "chrome",
          browserName: "Chrome",
          startedAtMs: 0,
        },
      ],
      [],
      parseQuery("zzz"),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("surfaces commands only on a strong match", () => {
    expect(searchCommands(parseQuery("sync"))[0].key).toBe("command:sync");
    expect(searchCommands(parseQuery("a"))).toEqual([]);
    expect(searchCommands(parseQuery("wallpaper"))[0].key).toBe("command:settings:wallpaper");
    expect(searchCommands(parseQuery("dark mode"))[0].key).toBe("command:toggle-theme");
    expect(searchCommands(parseQuery(""))).toEqual([]);
  });
});

describe("buildGroups", () => {
  it("orders groups by their best hit and truncates in the mixed view", () => {
    const hit = (key: string, score: number) =>
      ({ key, score, title: key }) as unknown as import("../types").SearchHit;
    const groups = buildGroups(
      {
        tabs: [hit("t1", 50)],
        bookmarks: Array.from({ length: 9 }, (_, i) => hit(`b${i}`, 90 - i)),
      },
      "all",
    );
    expect(groups.map((g) => g.id)).toEqual(["bookmarks", "tabs"]);
    expect(groups[0].hits).toHaveLength(5);
    expect(groups[0].total).toBe(9);
    expect(flattenGroups(groups)).toHaveLength(6);
    expect(buildGroups({ tabs: [hit("t", 1)] }, "bookmarks")).toEqual([]);
  });
});
