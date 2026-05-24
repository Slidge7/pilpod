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

    expect(registry.applyMediaSnapshot(2, { hasSignal: false, playbackState: "paused" })).toBe(true);
    expect(registry.isDirty()).toBe(true);
    expect(registry.get(2)?.media).toBeNull();
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
      label: "watch + active + paused → media cleared",
      tab: { url: YT_WATCH, active: true, audible: false },
      snap: { playbackState: "paused", hasSignal: false },
      expectMedia: false,
    },
    {
      label: "home + active + playing → media cleared (URL)",
      tab: { url: YT_HOME, active: true, audible: false },
      snap: { playbackState: "playing", hasSignal: true },
      expectMedia: false,
    },
    {
      label: "watch + inactive + playing → media cleared",
      tab: { url: YT_WATCH, active: false, audible: false },
      snap: { playbackState: "playing", hasSignal: true },
      expectMedia: false,
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

  it.each(gateCases)("$label", ({ tab, snap, expectMedia }) => {
    registry.upsert(mockTab(10, tab));
    registry.applyMediaSnapshot(10, { ...baseSnap(), ...snap });
    if (expectMedia) {
      expect(registry.get(10)?.media).not.toBeNull();
    } else {
      expect(registry.get(10)?.media).toBeNull();
    }
  });
});
