import { describe, expect, it } from "vitest";
import type { BrowserTab } from "../../../../types/media";
import {
  isTabMuted,
  mediaProgress,
  sameCardTab,
  tabLifecycle,
} from "../tabCard";

function tab(over: Partial<BrowserTab> = {}): BrowserTab {
  return { tabId: 1, windowId: 1, url: "https://a.com/", title: "A", ...over };
}

describe("tabLifecycle", () => {
  it("surfaces only the states worth a badge", () => {
    expect(tabLifecycle("Sleeping")).toBe("sleeping");
    expect(tabLifecycle("loading")).toBe("loading");
    expect(tabLifecycle("crashed")).toBe("crashed");
    expect(tabLifecycle("active")).toBeNull();
    expect(tabLifecycle(undefined)).toBeNull();
  });
});

describe("mediaProgress", () => {
  it("is a clamped fraction of the duration", () => {
    expect(
      mediaProgress(
        tab({
          media: { playbackState: "playing", duration: 200, currentTime: 50 },
        }),
      ),
    ).toBe(0.25);
    expect(
      mediaProgress(
        tab({
          media: { playbackState: "playing", duration: 10, currentTime: 99 },
        }),
      ),
    ).toBe(1);
    expect(
      mediaProgress(
        tab({
          media: { playbackState: "playing", duration: 10, currentTime: -3 },
        }),
      ),
    ).toBe(0);
  });

  it("is null without a usable duration (live streams, plain pages)", () => {
    expect(mediaProgress(tab())).toBeNull();
    expect(
      mediaProgress(tab({ media: { playbackState: "playing", duration: 0 } })),
    ).toBeNull();
    expect(
      mediaProgress(
        tab({ media: { playbackState: "playing", duration: Number.NaN } }),
      ),
    ).toBeNull();
  });
});

describe("isTabMuted", () => {
  it("honours both the browser mute and PilPod's per-tab mute", () => {
    expect(isTabMuted(tab({ muted: true }))).toBe(true);
    expect(
      isTabMuted(tab({ media: { playbackState: "playing", tabMuted: true } })),
    ).toBe(true);
    expect(isTabMuted(tab())).toBe(false);
  });
});

describe("sameCardTab", () => {
  const playing = (currentTime: number, over: Partial<BrowserTab> = {}) =>
    tab({
      media: { playbackState: "playing", duration: 300, currentTime },
      ...over,
    });

  it("ignores sub-second playback ticks", () => {
    expect(sameCardTab(playing(10.1), playing(10.9))).toBe(true);
  });

  it("re-renders when the visible second changes", () => {
    expect(sameCardTab(playing(10.9), playing(11.0))).toBe(false);
  });

  it("re-renders on any displayed field", () => {
    expect(sameCardTab(tab(), tab({ title: "B" }))).toBe(false);
    expect(sameCardTab(tab(), tab({ audible: true }))).toBe(false);
    expect(sameCardTab(playing(1), playing(1, { muted: true }))).toBe(false);
    expect(sameCardTab(tab(), playing(1))).toBe(false);
  });

  it("treats two media-less snapshots as equal", () => {
    expect(sameCardTab(tab({ media: null }), tab())).toBe(true);
  });
});
