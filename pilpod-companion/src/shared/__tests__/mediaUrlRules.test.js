import { describe, it, expect } from "vitest";
import { isMediaUrl, matchMediaUrlRule } from "../mediaUrlRules.js";

describe("isMediaUrl", () => {
  const cases = [
    ["https://www.youtube.com/", false],
    ["https://www.youtube.com/feed/subscriptions", false],
    ["https://www.youtube.com/watch?v=abc123", true],
    ["https://www.youtube.com/shorts/abc", true],
    ["https://youtu.be/abc123", true],
    ["https://music.youtube.com/watch?v=abc", true],
    ["https://open.spotify.com/track/abc", true],
    ["https://open.spotify.com/playlist/abc", true],
    ["https://open.spotify.com/", false],
    ["https://www.netflix.com/watch/12345", true],
    ["https://www.netflix.com/browse", false],
    ["https://www.tiktok.com/@user/video/123", true],
    ["https://www.tiktok.com/@user", false],
    ["https://example.com/video.mp4", true],
    ["https://cdn.example.com/stream.m3u8", true],
    ["https://example.com/page.html", false],
    ["https://mail.google.com/mail/u/0/", false],
    ["https://github.com", false],
    ["not-a-url", false],
    // Broad-host path-prefix rules
    ["https://soundcloud.com/", false],
    ["https://soundcloud.com/discover", false],
    ["https://soundcloud.com/artist/track-name", true],
    ["https://kick.com/", false],
    ["https://kick.com/browse", false],
    ["https://kick.com/xqc", true],
    ["https://rumble.com/", false],
    ["https://rumble.com/c/SomeChannel", false],
    ["https://rumble.com/v123abc-title.html", true],
    ["https://rumble.com/embed/abc123", true],
  ];

  it.each(cases)("%s → %s", (url, expected) => {
    expect(isMediaUrl(url)).toBe(expected);
  });
});

describe("matchMediaUrlRule", () => {
  it("returns rule id for known matches", () => {
    expect(matchMediaUrlRule("https://www.youtube.com/watch?v=abc")).toBe("youtube-watch");
    expect(matchMediaUrlRule("https://example.com/file.mp4")).toBe("direct-mp4");
    expect(matchMediaUrlRule("https://soundcloud.com/user/track")).toBe("soundcloud-track");
    expect(matchMediaUrlRule("https://kick.com/streamer")).toBe("kick-stream");
  });

  it("returns null for non-matches", () => {
    expect(matchMediaUrlRule("https://example.com/")).toBeNull();
    expect(matchMediaUrlRule("invalid")).toBeNull();
  });
});
