import { describe, it, expect, beforeEach } from "vitest";
import { TabRegistry } from "./registry.js";

const YT_WATCH = "https://www.youtube.com/watch?v=abc";
const YT_HOME = "https://www.youtube.com/";
const EXAMPLE = "https://example.com/";

/** @returns {chrome.tabs.Tab} */
function mockTab(id, overrides = {}) {
  return {
    id,
    windowId: 1,
    url: YT_WATCH,
    title: "Example",
    favIconUrl: "",
    active: false,
    audible: false,
    mutedInfo: { muted: false },
    pinned: false,
    index: 0,
    status: "complete",
    discarded: false,
    ...overrides,
  };
}

/** @param {object} [overrides] */
function baseSnap(overrides = {}) {
  return {
    hasSignal: true,
    playbackState: "playing",
    title: "Track A",
    artist: "",
    album: "",
    artworkUrl: "",
    duration: 100,
    currentTime: 10,
    pageVisible: true,
    userIdleMs: 0,
    documentState: "complete",
    ...overrides,
  };
}

describe("TabRegistry dirty tracking", () => {
  /** @type {TabRegistry} */
  let registry;

  beforeEach(() => {
    registry = new TabRegistry();
  });

  it("starts clean", () => {
    expect(registry.isDirty()).toBe(false);
  });

  it("markDirty / clearDirty lifecycle", () => {
    registry.markDirty();
    expect(registry.isDirty()).toBe(true);
    registry.clearDirty();
    expect(registry.isDirty()).toBe(false);
  });

  it("applyMediaSnapshot sets dirty only when media changes", () => {
    registry.upsert(mockTab(1, { url: YT_WATCH, active: true }));
    registry.clearDirty();

    const snap = baseSnap();

    expect(registry.applyMediaSnapshot(1, snap)).toBe(true);
    expect(registry.isDirty()).toBe(true);

    registry.clearDirty();
    expect(registry.applyMediaSnapshot(1, { ...snap })).toBe(false);
    expect(registry.isDirty()).toBe(false);

    expect(registry.applyMediaSnapshot(1, { ...snap, title: "Track B" })).toBe(true);
    expect(registry.isDirty()).toBe(true);
  });

  it("clearing media with failed gate marks dirty", () => {
    registry.upsert(mockTab(2, { url: YT_WATCH, active: true }));
    registry.applyMediaSnapshot(2, baseSnap());
    registry.clearDirty();

    registry.upsert(mockTab(2, { url: EXAMPLE, active: true }));
    expect(registry.applyMediaSnapshot(2, { hasSignal: false, playbackState: "paused" })).toBe(true);
    expect(registry.isDirty()).toBe(true);
    expect(registry.get(2)?.media).toBeNull();
  });

  it("allowlisted URL keeps media snapshot when paused", () => {
    registry.upsert(mockTab(5, { url: YT_WATCH, active: false, audible: false }));
    registry.applyMediaSnapshot(5, baseSnap());
    registry.clearDirty();

    expect(registry.applyMediaSnapshot(5, { ...baseSnap(), playbackState: "paused", hasSignal: false })).toBe(true);
    expect(registry.get(5)?.media?.playbackState).toBe("paused");
  });

  it("downgrades phantom playing on inactive silent tabs without signal", () => {
    registry.upsert(mockTab(6, { url: YT_WATCH, active: false, audible: false }));
    registry.applyMediaSnapshot(6, {
      ...baseSnap(),
      playbackState: "playing",
      hasSignal: false,
    });

    expect(registry.get(6)?.media?.playbackState).toBe("paused");
  });

  it("keeps playing on inactive silent tabs when signal is present", () => {
    registry.upsert(mockTab(7, { url: YT_WATCH, active: false, audible: false }));
    registry.applyMediaSnapshot(7, {
      ...baseSnap(),
      playbackState: "playing",
      hasSignal: true,
    });

    expect(registry.get(7)?.media?.playbackState).toBe("playing");
  });

  it("upsert marks dirty when tab metadata changes", () => {
    registry.upsert(mockTab(3, { title: "Before" }));
    registry.clearDirty();

    expect(registry.upsert(mockTab(3, { title: "After" }))).toBe(true);
    expect(registry.isDirty()).toBe(true);
  });

  it("evict marks dirty", () => {
    registry.upsert(mockTab(4));
    registry.clearDirty();

    expect(registry.evict(4)).toBe(true);
    expect(registry.isDirty()).toBe(true);
  });
});

describe("TabRegistry media gate", () => {
  /** @type {TabRegistry} */
  let registry;

  beforeEach(() => {
    registry = new TabRegistry();
  });

  const gateCases = [
    {
      label: "watch + active + playing → media set",
      tab: { url: YT_WATCH, active: true, audible: false },
      snap: { playbackState: "playing", hasSignal: true },
      expectMedia: true,
    },
    {
      label: "watch + active + paused → media set",
      tab: { url: YT_WATCH, active: true, audible: false },
      snap: { playbackState: "paused", hasSignal: false },
      expectMedia: true,
    },
    {
      label: "home + active + playing → media cleared (URL)",
      tab: { url: YT_HOME, active: true, audible: false },
      snap: { playbackState: "playing", hasSignal: true },
      expectMedia: false,
    },
    {
      label: "watch + inactive + playing without signal → stored as paused",
      tab: { url: YT_WATCH, active: false, audible: false },
      snap: { playbackState: "playing", hasSignal: false },
      expectMedia: true,
      expectPlaybackState: "paused",
    },
    {
      label: "watch + inactive + playing → media set",
      tab: { url: YT_WATCH, active: false, audible: false },
      snap: { playbackState: "playing", hasSignal: true },
      expectMedia: true,
      expectPlaybackState: "playing",
    },
    {
      label: "watch + inactive + audible + playing → media set",
      tab: { url: YT_WATCH, active: false, audible: true },
      snap: { playbackState: "playing", hasSignal: true },
      expectMedia: true,
    },
    {
      label: "example.com + active + playing → media cleared (URL)",
      tab: { url: EXAMPLE, active: true, audible: false },
      snap: { playbackState: "playing", hasSignal: true },
      expectMedia: false,
    },
  ];

  it.each(gateCases)("$label", ({ tab, snap, expectMedia, expectPlaybackState = null }) => {
    registry.upsert(mockTab(10, tab));
    registry.applyMediaSnapshot(10, { ...baseSnap(), ...snap });
    if (expectMedia) {
      expect(registry.get(10)?.media).not.toBeNull();
      if (expectPlaybackState) {
        expect(registry.get(10)?.media?.playbackState).toBe(expectPlaybackState);
      }
    } else {
      expect(registry.get(10)?.media).toBeNull();
    }
  });
});
