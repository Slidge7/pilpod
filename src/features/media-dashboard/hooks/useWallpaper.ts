import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppearanceMode } from "../../../theme/appearance";
import {
  WALLPAPER_AUTOSWITCH_STORAGE_KEY,
  WALLPAPER_DEFAULT_INTERVAL,
  WALLPAPER_INTERVAL_STORAGE_KEY,
  WALLPAPER_INTERVALS,
  WALLPAPER_RANDOM_STORAGE_KEY,
  WALLPAPER_SELECTION_STORAGE_KEY,
  type WallpaperIntervalId,
} from "../constants";

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function intervalMsFor(id: WallpaperIntervalId): number {
  return (
    WALLPAPER_INTERVALS.find((i) => i.id === id)?.ms ??
    WALLPAPER_INTERVALS.find((i) => i.id === WALLPAPER_DEFAULT_INTERVAL)!.ms
  );
}

function readStoredInterval(): WallpaperIntervalId {
  const raw = readLS(WALLPAPER_INTERVAL_STORAGE_KEY);
  if (raw && WALLPAPER_INTERVALS.some((i) => i.id === raw)) {
    return raw as WallpaperIntervalId;
  }
  return WALLPAPER_DEFAULT_INTERVAL;
}

export type WallpaperController = {
  /** Names available (present in both light + dark folders), sorted. */
  names: string[];
  /** Currently selected name, or null when the wallpaper is off. */
  current: string | null;
  /** Data URL of the current wallpaper (matched to appearance), or null. */
  dataUrl: string | null;
  enabled: boolean;
  random: boolean;
  autoSwitch: boolean;
  intervalId: WallpaperIntervalId;
  next: () => void;
  prev: () => void;
  toggleEnabled: () => void;
  toggleRandom: () => void;
  toggleAutoSwitch: () => void;
  setIntervalId: (id: WallpaperIntervalId) => void;
};

export function useWallpaper(appearance: AppearanceMode): WallpaperController {
  const [names, setNames] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(() => {
    const raw = readLS(WALLPAPER_SELECTION_STORAGE_KEY);
    return raw ? raw : null; // "" or missing => off
  });
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [random, setRandom] = useState<boolean>(
    () => readLS(WALLPAPER_RANDOM_STORAGE_KEY) === "1",
  );
  const [autoSwitch, setAutoSwitch] = useState<boolean>(
    () => readLS(WALLPAPER_AUTOSWITCH_STORAGE_KEY) === "1",
  );
  const [intervalId, setIntervalIdState] =
    useState<WallpaperIntervalId>(readStoredInterval);

  // Load the list of bundled wallpapers once.
  useEffect(() => {
    let cancelled = false;
    void invoke<string[]>("list_wallpapers")
      .then((list) => {
        if (cancelled) return;
        setNames(list ?? []);
      })
      .catch((err) => {
        console.error("[wallpaper] list_wallpapers failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Drop a stored selection that no longer exists after the list loads.
  useEffect(() => {
    if (current && names.length > 0 && !names.includes(current)) {
      setCurrent(null);
      writeLS(WALLPAPER_SELECTION_STORAGE_KEY, "");
    }
  }, [names, current]);

  // Load the image for the current selection + appearance. Switching
  // appearance keeps the same wallpaper but swaps to the matching variant.
  useEffect(() => {
    if (!current) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    void invoke<string | null>("read_wallpaper", {
      mode: appearance,
      name: current,
    })
      .then((url) => {
        if (cancelled) return;
        if (url) setDataUrl(url);
        else setDataUrl(null);
      })
      .catch((err) => {
        console.error("[wallpaper] read_wallpaper failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [current, appearance]);

  const select = useCallback((name: string | null) => {
    setCurrent(name);
    writeLS(WALLPAPER_SELECTION_STORAGE_KEY, name ?? "");
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (names.length === 0) return;
      // Turning on from off starts at the first (or a random) wallpaper.
      if (!current) {
        select(random ? names[Math.floor(Math.random() * names.length)] : names[0]);
        return;
      }
      if (random && names.length > 1) {
        let pick = current;
        while (pick === current) {
          pick = names[Math.floor(Math.random() * names.length)];
        }
        select(pick);
        return;
      }
      const idx = names.indexOf(current);
      const nextIdx = (idx + dir + names.length) % names.length;
      select(names[nextIdx]);
    },
    [names, current, random, select],
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  const toggleEnabled = useCallback(() => {
    if (current) {
      select(null);
    } else if (names.length > 0) {
      select(random ? names[Math.floor(Math.random() * names.length)] : names[0]);
    }
  }, [current, names, random, select]);

  const toggleRandom = useCallback(() => {
    setRandom((r) => {
      const nextVal = !r;
      writeLS(WALLPAPER_RANDOM_STORAGE_KEY, nextVal ? "1" : "0");
      return nextVal;
    });
  }, []);

  const toggleAutoSwitch = useCallback(() => {
    setAutoSwitch((a) => {
      const nextVal = !a;
      writeLS(WALLPAPER_AUTOSWITCH_STORAGE_KEY, nextVal ? "1" : "0");
      return nextVal;
    });
  }, []);

  const setIntervalId = useCallback((id: WallpaperIntervalId) => {
    setIntervalIdState(id);
    writeLS(WALLPAPER_INTERVAL_STORAGE_KEY, id);
  }, []);

  // Auto-switch timer. A ref keeps the advance fn current without resetting
  // the timer on every wallpaper change.
  const advanceRef = useRef(next);
  advanceRef.current = next;

  const enabled = current != null;
  const canAuto = autoSwitch && enabled && names.length > 1;
  const ms = intervalMsFor(intervalId);

  useEffect(() => {
    if (!canAuto) return;
    const timer = window.setInterval(() => advanceRef.current(), ms);
    return () => window.clearInterval(timer);
  }, [canAuto, ms]);

  return useMemo(
    () => ({
      names,
      current,
      dataUrl,
      enabled,
      random,
      autoSwitch,
      intervalId,
      next,
      prev,
      toggleEnabled,
      toggleRandom,
      toggleAutoSwitch,
      setIntervalId,
    }),
    [
      names,
      current,
      dataUrl,
      enabled,
      random,
      autoSwitch,
      intervalId,
      next,
      prev,
      toggleEnabled,
      toggleRandom,
      toggleAutoSwitch,
      setIntervalId,
    ],
  );
}
