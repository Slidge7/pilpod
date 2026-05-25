import { describe, it, expect } from "vitest";
import {
  urlMatchesStaticPatterns,
  originPatternsForDomain,
  hostnameFromUrl,
  isValidDomain,
} from "../staticMediaPatterns.js";

describe("urlMatchesStaticPatterns", () => {
  const matchCases = [
    "https://www.youtube.com/watch?v=abc123",
    "https://youtu.be/abc123",
    "https://music.youtube.com/watch?v=abc",
    "https://open.spotify.com/track/abc",
    "https://www.tiktok.com/@user/video/123",
    "https://soundcloud.com/artist/track-name",
    "https://www.netflix.com/watch/12345",
    "https://listen.tidal.com/browse",
  ];

  it.each(matchCases)("matches %s", (url) => {
    expect(urlMatchesStaticPatterns(url)).toBe(true);
  });

  it("does not match unrelated sites", () => {
    expect(urlMatchesStaticPatterns("https://example.com/page.html")).toBe(false);
    expect(urlMatchesStaticPatterns("https://mail.google.com/mail/")).toBe(false);
  });
});

describe("originPatternsForDomain", () => {
  it("returns wildcard and apex patterns", () => {
    expect(originPatternsForDomain("mycustomplayer.com")).toEqual([
      "*://*.mycustomplayer.com/*",
      "*://mycustomplayer.com/*",
    ]);
  });
});

describe("hostnameFromUrl", () => {
  it("strips www prefix", () => {
    expect(hostnameFromUrl("https://www.youtube.com/watch")).toBe("youtube.com");
  });
});

describe("isValidDomain", () => {
  it("accepts valid domains", () => {
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("sub.example.co.uk")).toBe(true);
  });

  it("rejects invalid domains", () => {
    expect(isValidDomain("")).toBe(false);
    expect(isValidDomain("not a domain")).toBe(false);
  });
});
