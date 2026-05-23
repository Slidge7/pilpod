import { describe, it, expect, beforeEach } from "vitest";
import { TabRegistry } from "./registry.js";

/** @returns {chrome.tabs.Tab} */
function mockTab(id, overrides = {}) {
  return {
    id,
    windowId: 1,
    url: "https://example.com/",
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
    registry.upsert(mockTab(1));
    registry.clearDirty();

    const snap = {
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
    };

    expect(registry.applyMediaSnapshot(1, snap)).toBe(true);
    expect(registry.isDirty()).toBe(true);

    registry.clearDirty();
    expect(registry.applyMediaSnapshot(1, { ...snap })).toBe(false);
    expect(registry.isDirty()).toBe(false);

    expect(registry.applyMediaSnapshot(1, { ...snap, title: "Track B" })).toBe(true);
    expect(registry.isDirty()).toBe(true);
  });

  it("clearing media with hasSignal false marks dirty", () => {
    registry.upsert(mockTab(2));
    registry.applyMediaSnapshot(2, {
      hasSignal: true,
      playbackState: "playing",
      title: "Song",
      artist: "",
      album: "",
      artworkUrl: "",
      duration: 0,
      currentTime: 0,
      pageVisible: true,
      userIdleMs: 0,
      documentState: "complete",
    });
    registry.clearDirty();

    expect(registry.applyMediaSnapshot(2, { hasSignal: false })).toBe(true);
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
