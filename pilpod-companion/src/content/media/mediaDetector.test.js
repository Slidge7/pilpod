import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolvePlaybackState } from "./mediaDetector.js";

function mockVideo({ paused = true, ended = false, readyState = 0 } = {}) {
  return {
    paused,
    ended,
    readyState,
    addEventListener: vi.fn(),
  };
}

describe("resolvePlaybackState", () => {
  /** @type {string} */
  let visibilityState;

  beforeEach(() => {
    visibilityState = "visible";
    vi.stubGlobal("document", {
      get visibilityState() {
        return visibilityState;
      },
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
    });
    vi.stubGlobal("navigator", {
      mediaSession: { playbackState: "none", metadata: null },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns playing when a media element is actively playing", () => {
    document.querySelectorAll = vi.fn((selector) => {
      if (selector === "video" || selector === "audio") {
        return [mockVideo({ paused: false, readyState: 4 })];
      }
      return [];
    });

    expect(resolvePlaybackState()).toBe("playing");
  });

  it("ignores MediaSession playing on hidden pages without a playing element", () => {
    visibilityState = "hidden";
    navigator.mediaSession.playbackState = "playing";
    document.querySelectorAll = vi.fn(() => []);

    expect(resolvePlaybackState()).toBe("none");
  });

  it("trusts MediaSession playing on visible pages", () => {
    visibilityState = "visible";
    navigator.mediaSession.playbackState = "playing";
    document.querySelectorAll = vi.fn(() => []);

    expect(resolvePlaybackState()).toBe("playing");
  });

  it("returns paused when a loaded element is paused", () => {
    document.querySelectorAll = vi.fn((selector) => {
      if (selector === "video" || selector === "audio") {
        return [mockVideo({ paused: true, readyState: 2 })];
      }
      return [];
    });

    expect(resolvePlaybackState()).toBe("paused");
  });
});
