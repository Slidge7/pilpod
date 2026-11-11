import { describe, expect, it } from "vitest";
import type { BrowserTab } from "../../../../../../types/media";
import {
  hueFor,
  tabIconTile,
  tabThumbnailSources,
  youtubeVideoId,
} from "../thumbnail";

const ID = "dQw4w9WgXcQ";

function tab(over: Partial<BrowserTab> = {}): BrowserTab {
  return {
    tabId: 1,
    windowId: 1,
    url: "https://example.com/",
    title: "Example",
    ...over,
  };
}

describe("youtubeVideoId", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&list=RD`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ])("extracts the id from %s", (url) => {
    expect(youtubeVideoId(url)).toBe(ID);
  });

  it.each([
    undefined,
    "",
    "not a url",
    "https://www.youtube.com/",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/@channel",
    `https://example.com/watch?v=${ID}`,
    `https://notyoutube.com/watch?v=${ID}`,
  ])("rejects %s", (url) => {
    expect(youtubeVideoId(url)).toBeNull();
  });
});

describe("tabThumbnailSources", () => {
  it("puts media artwork before the derived YouTube thumbnail", () => {
    const sources = tabThumbnailSources(
      tab({
        url: `https://www.youtube.com/watch?v=${ID}`,
        media: {
          playbackState: "playing",
          artworkUrl: "https://art/cover.jpg",
        },
      }),
    );
    expect(sources).toEqual([
      "https://art/cover.jpg",
      `https://i.ytimg.com/vi/${ID}/mqdefault.jpg`,
    ]);
  });

  it("is empty for an ordinary page", () => {
    expect(tabThumbnailSources(tab())).toEqual([]);
  });

  it("ignores blank artwork", () => {
    expect(
      tabThumbnailSources(
        tab({ media: { playbackState: "paused", artworkUrl: "  " } }),
      ),
    ).toEqual([]);
  });
});

describe("tabIconTile", () => {
  it("prefers the favicon the browser reported", () => {
    expect(
      tabIconTile(tab({ favIconUrl: "https://example.com/f.ico" })).iconUrl,
    ).toBe("https://example.com/f.ico");
  });

  it("falls back to the favicon service for internal icon URLs", () => {
    expect(
      tabIconTile(tab({ favIconUrl: "chrome://favicon/x" })).iconUrl,
    ).toContain("domain=example.com");
  });

  it("gives every tab of one site the same colour", () => {
    const a = tabIconTile(tab({ url: "https://www.github.com/a" }));
    const b = tabIconTile(tab({ url: "https://github.com/b" }));
    expect(a.hue).toBe(b.hue);
    expect(a.letter).toBe("G");
  });
});

describe("hueFor", () => {
  it("stays within the colour wheel", () => {
    for (const key of ["", "a", "youtube.com", "x".repeat(500)]) {
      const hue = hueFor(key);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
