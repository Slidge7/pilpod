import { useEffect, useReducer, useRef } from "react";

export const WALLPAPER_TRANSITION_MS = 500;

export interface WallpaperTransitionState {
  currentUrl: string | null;
  previousUrl: string | null;
  isTransitioning: boolean;
  hasAnyWallpaper: boolean;
}

export type WallpaperAction =
  | { type: "TARGET_CHANGED"; targetUrl: string | null }
  | { type: "TRANSITION_SETTLED" };

export function initialWallpaperState(targetUrl: string | null): WallpaperTransitionState {
  return {
    currentUrl: targetUrl,
    previousUrl: null,
    isTransitioning: false,
    hasAnyWallpaper: Boolean(targetUrl),
  };
}

export function wallpaperTransitionReducer(
  state: WallpaperTransitionState,
  action: WallpaperAction,
): WallpaperTransitionState {
  switch (action.type) {
    case "TARGET_CHANGED": {
      if (action.targetUrl === state.currentUrl) {
        return state;
      }
      return {
        previousUrl: state.currentUrl,
        currentUrl: action.targetUrl,
        isTransitioning: Boolean(state.currentUrl || action.targetUrl),
        hasAnyWallpaper: Boolean(state.currentUrl || action.targetUrl),
      };
    }
    case "TRANSITION_SETTLED": {
      return {
        previousUrl: null,
        currentUrl: state.currentUrl,
        isTransitioning: false,
        hasAnyWallpaper: Boolean(state.currentUrl),
      };
    }
  }
}

export function useWallpaperTransition(
  targetUrl: string | null,
  transitionDurationMs: number = WALLPAPER_TRANSITION_MS,
): WallpaperTransitionState {
  const [state, dispatch] = useReducer(
    wallpaperTransitionReducer,
    targetUrl,
    initialWallpaperState,
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTargetRef = useRef(targetUrl);

  useEffect(() => {
    if (targetUrl === lastTargetRef.current) {
      return;
    }
    lastTargetRef.current = targetUrl;
    dispatch({ type: "TARGET_CHANGED", targetUrl });

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      dispatch({ type: "TRANSITION_SETTLED" });
      timerRef.current = null;
    }, transitionDurationMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [targetUrl, transitionDurationMs]);

  return state;
}
