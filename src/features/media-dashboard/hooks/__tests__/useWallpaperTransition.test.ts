import { describe, expect, it } from "vitest";
import {
  initialWallpaperState,
  wallpaperTransitionReducer,
} from "../useWallpaperTransition";

describe("wallpaperTransitionReducer", () => {
  it("initializes correctly with a URL", () => {
    const state = initialWallpaperState("url-1");
    expect(state).toEqual({
      currentUrl: "url-1",
      previousUrl: null,
      isTransitioning: false,
      hasAnyWallpaper: true,
    });
  });

  it("initializes correctly with null", () => {
    const state = initialWallpaperState(null);
    expect(state).toEqual({
      currentUrl: null,
      previousUrl: null,
      isTransitioning: false,
      hasAnyWallpaper: false,
    });
  });

  it("ignores TARGET_CHANGED when url is identical", () => {
    const state = initialWallpaperState("url-1");
    const next = wallpaperTransitionReducer(state, {
      type: "TARGET_CHANGED",
      targetUrl: "url-1",
    });
    expect(next).toBe(state);
  });

  it("transitions between two wallpapers", () => {
    const state = initialWallpaperState("url-1");
    const transitioning = wallpaperTransitionReducer(state, {
      type: "TARGET_CHANGED",
      targetUrl: "url-2",
    });

    expect(transitioning).toEqual({
      previousUrl: "url-1",
      currentUrl: "url-2",
      isTransitioning: true,
      hasAnyWallpaper: true,
    });

    const settled = wallpaperTransitionReducer(transitioning, {
      type: "TRANSITION_SETTLED",
    });

    expect(settled).toEqual({
      previousUrl: null,
      currentUrl: "url-2",
      isTransitioning: false,
      hasAnyWallpaper: true,
    });
  });

  it("transitions to off (null)", () => {
    const state = initialWallpaperState("url-1");
    const fadingOut = wallpaperTransitionReducer(state, {
      type: "TARGET_CHANGED",
      targetUrl: null,
    });

    expect(fadingOut).toEqual({
      previousUrl: "url-1",
      currentUrl: null,
      isTransitioning: true,
      hasAnyWallpaper: true, // remains true during fade out
    });

    const settled = wallpaperTransitionReducer(fadingOut, {
      type: "TRANSITION_SETTLED",
    });

    expect(settled).toEqual({
      previousUrl: null,
      currentUrl: null,
      isTransitioning: false,
      hasAnyWallpaper: false,
    });
  });

  it("transitions from off (null) to a wallpaper", () => {
    const state = initialWallpaperState(null);
    const fadingIn = wallpaperTransitionReducer(state, {
      type: "TARGET_CHANGED",
      targetUrl: "url-1",
    });

    expect(fadingIn).toEqual({
      previousUrl: null,
      currentUrl: "url-1",
      isTransitioning: true,
      hasAnyWallpaper: true,
    });

    const settled = wallpaperTransitionReducer(fadingIn, {
      type: "TRANSITION_SETTLED",
    });

    expect(settled).toEqual({
      previousUrl: null,
      currentUrl: "url-1",
      isTransitioning: false,
      hasAnyWallpaper: true,
    });
  });

  it("handles rapid changes before settling", () => {
    const state = initialWallpaperState("url-1");
    const trans1 = wallpaperTransitionReducer(state, {
      type: "TARGET_CHANGED",
      targetUrl: "url-2",
    });
    const trans2 = wallpaperTransitionReducer(trans1, {
      type: "TARGET_CHANGED",
      targetUrl: "url-3",
    });

    expect(trans2).toEqual({
      previousUrl: "url-2",
      currentUrl: "url-3",
      isTransitioning: true,
      hasAnyWallpaper: true,
    });
  });
});
