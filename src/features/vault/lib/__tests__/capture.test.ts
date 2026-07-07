import { describe, it, expect } from "vitest";
import { captureBookmark, captureMedia, deriveMediaKind } from "../capture";
import type { BrowserTab } from "../../../../types/media";

function tab(over: Partial<BrowserTab> = {}): BrowserTab {
  return {
    tabId: 1,
    windowId: 1,
    url: "https://example.com/page",
    title: "  Example Page  ",
    ...over,
  };
}

describe("deriveMediaKind", () => {
  it("classifies audio by extension", () => {
    expect(deriveMediaKind("https://cdn.site/song.mp3")).toBe("audio");
  });
  it("classifies video by extension", () => {
    expect(deriveMediaKind("https://cdn.site/clip.mp4")).toBe("video");
  });
  it("classifies audio by rule hint", () => {
    expect(deriveMediaKind("https://open.spotify.com/track/x", "spotify-track")).toBe("audio");
  });
  it("classifies known media rule as video by default", () => {
    expect(deriveMediaKind("https://youtube.com/watch?v=x", "youtube-watch")).toBe("video");
  });
  it("unknown when nothing matches", () => {
    expect(deriveMediaKind("https://example.com/page")).toBe("unknown");
  });
});

describe("captureBookmark", () => {
  it("trims title and captures provenance", () => {
    const args = captureBookmark(tab(), { osBrowserId: "chrome", profileLabel: "Work" });
    expect(args.url).toBe("https://example.com/page");
    expect(args.title).toBe("Example Page");
    expect(args.sourceOsBrowserId).toBe("chrome");
    expect(args.sourceProfileLabel).toBe("Work");
  });
});

describe("captureMedia", () => {
  it("pulls media metadata and derives kind", () => {
    const args = captureMedia(
      tab({
        url: "https://open.spotify.com/track/abc",
        media: {
          playbackState: "playing",
          title: "Song",
          artist: "Artist",
          duration: 210,
          mediaMatchRule: "spotify-track",
        },
      }),
      { osBrowserId: "chrome" },
    );
    expect(args.mediaTitle).toBe("Song");
    expect(args.artist).toBe("Artist");
    expect(args.durationSecs).toBe(210);
    expect(args.kind).toBe("audio");
  });
});
