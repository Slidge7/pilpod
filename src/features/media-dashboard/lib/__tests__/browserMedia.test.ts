import { describe, it, expect } from "vitest";
import {
  tabHasMedia,
  tabHasMediaControls,
  tabIsLinkIdentifiedMedia,
  collectActiveMediaTabs,
} from "../browserMedia";
import type { BrowserTab } from "../../../../types/media";

function tab(
  media: BrowserTab["media"],
  overrides: Partial<BrowserTab> = {},
): BrowserTab {
  return {
    tabId: 1,
    windowId: 1,
    url: "https://example.com",
    title: "Example",
    media,
    ...overrides,
  };
}

describe("tabHasMedia", () => {
  it("returns false when media is null", () => {
    expect(tabHasMedia(tab(null))).toBe(false);
  });

  it("returns true when playbackState is playing", () => {
    expect(tabHasMedia(tab({ playbackState: "playing" }))).toBe(true);
  });

  it("returns false when paused even with title and duration", () => {
    expect(
      tabHasMedia(
        tab({
          playbackState: "paused",
          title: "Song",
          duration: 300,
        }),
      ),
    ).toBe(false);
  });

  it("returns false when playbackState is empty with title", () => {
    expect(
      tabHasMedia(
        tab({
          playbackState: "",
          title: "Song",
        }),
      ),
    ).toBe(false);
  });

  it("returns true for uppercase PLAYING", () => {
    expect(tabHasMedia(tab({ playbackState: "PLAYING" }))).toBe(true);
  });
});

describe("tabIsLinkIdentifiedMedia", () => {
  it("returns true for allowlisted URLs without media snapshot", () => {
    expect(
      tabIsLinkIdentifiedMedia(
        tab(null, { url: "https://www.youtube.com/watch?v=abc" }),
      ),
    ).toBe(true);
  });

  it("returns true when mediaMatchRule is present", () => {
    expect(
      tabIsLinkIdentifiedMedia(
        tab({ playbackState: "none", mediaMatchRule: "youtube-watch" }),
      ),
    ).toBe(true);
  });

  it("returns false for non-allowlisted URLs without mediaMatchRule", () => {
    expect(tabIsLinkIdentifiedMedia(tab(null, { url: "https://example.com" }))).toBe(
      false,
    );
  });

  it("returns true for inactive sleeping allowlisted tab by URL only", () => {
    expect(
      tabIsLinkIdentifiedMedia(
        tab(null, {
          url: "https://open.spotify.com/track/abc",
          tabState: "sleeping",
          active: false,
        }),
      ),
    ).toBe(true);
  });
});

describe("tabHasMediaControls", () => {
  it("returns false without media snapshot", () => {
    expect(
      tabHasMediaControls(
        tab(null, { url: "https://www.youtube.com/watch?v=abc" }),
      ),
    ).toBe(false);
  });

  it("returns true when paused on allowlisted URL", () => {
    expect(
      tabHasMediaControls(
        tab(
          { playbackState: "paused", mediaMatchRule: "youtube-watch" },
          { url: "https://www.youtube.com/watch?v=abc" },
        ),
      ),
    ).toBe(true);
  });

  it("returns false for non-allowlisted URL even when playing", () => {
    expect(
      tabHasMediaControls(
        tab({ playbackState: "playing" }, { url: "https://example.com" }),
      ),
    ).toBe(false);
  });
});

describe("collectActiveMediaTabs", () => {
  const browsers = [
    {
      id: "chrome-default",
      displayName: "Chrome",
      extensionConnected: true,
      tabs: [
        tab(
          { playbackState: "playing", mediaMatchRule: "youtube-watch" },
          { tabId: 1, url: "https://www.youtube.com/watch?v=a" },
        ),
        tab(
          { playbackState: "paused", mediaMatchRule: "youtube-watch" },
          { tabId: 2, url: "https://www.youtube.com/watch?v=b" },
        ),
        tab(null, { tabId: 3, url: "https://example.com" }),
      ],
    },
    {
      id: "firefox-default",
      displayName: "Firefox",
      extensionConnected: false,
      tabs: [
        tab(
          { playbackState: "playing", mediaMatchRule: "youtube-watch" },
          { tabId: 4, url: "https://www.youtube.com/watch?v=c" },
        ),
      ],
    },
  ];

  it("collects playing and paused media tabs from connected browsers only", () => {
    const matches = collectActiveMediaTabs(browsers);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.tab.tabId)).toEqual([1, 2]);
    expect(matches[0]?.browserId).toBe("chrome-default");
  });

  it("sorts playing tabs before paused tabs", () => {
    const matches = collectActiveMediaTabs([
      {
        id: "b1",
        displayName: "Browser",
        extensionConnected: true,
        tabs: [
          tab(
            { playbackState: "paused", mediaMatchRule: "youtube-watch" },
            { tabId: 10, title: "B" },
          ),
          tab(
            { playbackState: "playing", mediaMatchRule: "youtube-watch" },
            { tabId: 11, title: "A" },
          ),
        ],
      },
    ]);
    expect(matches.map((m) => m.tab.tabId)).toEqual([11, 10]);
  });
});
