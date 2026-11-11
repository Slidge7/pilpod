import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useStorageSync } from "../../../shared/useStorageSync";
import {
  WALLPAPER_AUTOSWITCH_STORAGE_KEY,
  WALLPAPER_CUSTOM_FOLDER_STORAGE_KEY,
  WALLPAPER_CUSTOM_PATHS_STORAGE_KEY,
  WALLPAPER_CUSTOM_SELECTION_STORAGE_KEY,
  WALLPAPER_DEFAULT_INTERVAL,
  WALLPAPER_DEFAULT_SOURCE,
  WALLPAPER_IMAGE_EXTENSIONS,
  WALLPAPER_INTERVAL_STORAGE_KEY,
  WALLPAPER_INTERVALS,
  WALLPAPER_RANDOM_STORAGE_KEY,
  WALLPAPER_SELECTION_STORAGE_KEY,
  WALLPAPER_SOURCE_STORAGE_KEY,
  type WallpaperIntervalId,
  type WallpaperSource,
} from "../constants";
import { wallpaperBaseName } from "../lib/wallpaperName";

/**
 * The wallpaper *preferences* — which images, which one is on, how it
 * rotates — with no image loading and no timer.
 *
 * Split out of `useWallpaper` so a window can edit the dashboard's wallpaper
 * without showing it: PilPod Sky's settings use this hook alone, while the
 * dashboard wraps it with the loader and the auto-switch timer. Everything is
 * stored in localStorage and re-read when another window changes it, so the
 * dashboard follows a choice made in Sky the moment it is made.
 */

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

function readStoredInterval(): WallpaperIntervalId {
  const raw = readLS(WALLPAPER_INTERVAL_STORAGE_KEY);
  if (raw && WALLPAPER_INTERVALS.some((i) => i.id === raw)) {
    return raw as WallpaperIntervalId;
  }
  return WALLPAPER_DEFAULT_INTERVAL;
}

function readStoredSource(): WallpaperSource {
  return readLS(WALLPAPER_SOURCE_STORAGE_KEY) === "custom"
    ? "custom"
    : WALLPAPER_DEFAULT_SOURCE;
}

function readStoredCustomPaths(): string[] {
  const raw = readLS(WALLPAPER_CUSTOM_PATHS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((p): p is string => typeof p === "string");
    }
  } catch {
    /* ignore malformed */
  }
  return [];
}

/** `""` or missing ⇒ off. */
function readSelection(key: string): string | null {
  return readLS(key) || null;
}

const SYNCED_KEYS = [
  WALLPAPER_SOURCE_STORAGE_KEY,
  WALLPAPER_SELECTION_STORAGE_KEY,
  WALLPAPER_CUSTOM_PATHS_STORAGE_KEY,
  WALLPAPER_CUSTOM_SELECTION_STORAGE_KEY,
  WALLPAPER_CUSTOM_FOLDER_STORAGE_KEY,
  WALLPAPER_RANDOM_STORAGE_KEY,
  WALLPAPER_AUTOSWITCH_STORAGE_KEY,
  WALLPAPER_INTERVAL_STORAGE_KEY,
];

export function wallpaperIntervalMs(id: WallpaperIntervalId): number {
  return (
    WALLPAPER_INTERVALS.find((i) => i.id === id)?.ms ??
    WALLPAPER_INTERVALS.find((i) => i.id === WALLPAPER_DEFAULT_INTERVAL)!.ms
  );
}

export type WallpaperSettings = {
  /** Active source: bundled light/dark pairs, or the user's own images. */
  source: WallpaperSource;
  /** Names/paths available in the active source, sorted. */
  names: string[];
  /** Currently selected name/path, or null when the wallpaper is off. */
  current: string | null;
  /** Friendly display label for the current selection (file base name). */
  currentLabel: string | null;
  enabled: boolean;
  random: boolean;
  autoSwitch: boolean;
  intervalId: WallpaperIntervalId;
  /** True when the user has at least one custom image configured. */
  hasCustom: boolean;
  /** Folder the custom list came from, when it came from one. */
  customFolder: string | null;
  /** Show this image (a name from `names`), or turn the wallpaper off with `null`. */
  select: (name: string | null) => void;
  next: () => void;
  prev: () => void;
  toggleEnabled: () => void;
  toggleRandom: () => void;
  toggleAutoSwitch: () => void;
  setIntervalId: (id: WallpaperIntervalId) => void;
  setSource: (source: WallpaperSource) => void;
  /** Open a picker to add one or more images (appended to the custom list). */
  addCustomFiles: () => Promise<void>;
  /** Open a folder picker; every image inside becomes the custom list. */
  addCustomFolder: () => Promise<void>;
  /** Clear the custom list and revert to the default source. */
  clearCustom: () => void;
};

export function useWallpaperSettings(): WallpaperSettings {
  const [source, setSourceState] = useState<WallpaperSource>(readStoredSource);

  // Bundled (default) source ------------------------------------------------
  const [bundledNames, setBundledNames] = useState<string[]>([]);
  const [defaultCurrent, setDefaultCurrent] = useState<string | null>(() =>
    readSelection(WALLPAPER_SELECTION_STORAGE_KEY),
  );

  // Custom (user) source ----------------------------------------------------
  const [customPaths, setCustomPaths] = useState<string[]>(readStoredCustomPaths);
  const [customCurrent, setCustomCurrent] = useState<string | null>(() =>
    readSelection(WALLPAPER_CUSTOM_SELECTION_STORAGE_KEY),
  );
  const [customFolder, setCustomFolder] = useState<string | null>(() =>
    readSelection(WALLPAPER_CUSTOM_FOLDER_STORAGE_KEY),
  );

  const [random, setRandom] = useState<boolean>(
    () => readLS(WALLPAPER_RANDOM_STORAGE_KEY) === "1",
  );
  const [autoSwitch, setAutoSwitch] = useState<boolean>(
    () => readLS(WALLPAPER_AUTOSWITCH_STORAGE_KEY) === "1",
  );
  const [intervalId, setIntervalIdState] =
    useState<WallpaperIntervalId>(readStoredInterval);

  // Another window changed the wallpaper settings: take them as they are now.
  useStorageSync(SYNCED_KEYS, () => {
    setSourceState(readStoredSource());
    setDefaultCurrent(readSelection(WALLPAPER_SELECTION_STORAGE_KEY));
    setCustomPaths(readStoredCustomPaths());
    setCustomCurrent(readSelection(WALLPAPER_CUSTOM_SELECTION_STORAGE_KEY));
    setCustomFolder(readSelection(WALLPAPER_CUSTOM_FOLDER_STORAGE_KEY));
    setRandom(readLS(WALLPAPER_RANDOM_STORAGE_KEY) === "1");
    setAutoSwitch(readLS(WALLPAPER_AUTOSWITCH_STORAGE_KEY) === "1");
    setIntervalIdState(readStoredInterval());
  });

  // Active view over whichever source is selected.
  const names = source === "custom" ? customPaths : bundledNames;
  const current = source === "custom" ? customCurrent : defaultCurrent;

  // Load the list of bundled wallpapers once.
  useEffect(() => {
    let cancelled = false;
    void invoke<string[]>("list_wallpapers")
      .then((list) => {
        if (cancelled) return;
        setBundledNames(list ?? []);
      })
      .catch((err) => {
        console.error("[wallpaper] list_wallpapers failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Drop a stored bundled selection that no longer exists after the list loads.
  useEffect(() => {
    if (
      defaultCurrent &&
      bundledNames.length > 0 &&
      !bundledNames.includes(defaultCurrent)
    ) {
      setDefaultCurrent(null);
      writeLS(WALLPAPER_SELECTION_STORAGE_KEY, "");
    }
  }, [bundledNames, defaultCurrent]);

  // Keep the custom selection valid if the list changes underneath it.
  useEffect(() => {
    if (
      customCurrent &&
      customPaths.length > 0 &&
      !customPaths.includes(customCurrent)
    ) {
      setCustomCurrent(customPaths[0]);
      writeLS(WALLPAPER_CUSTOM_SELECTION_STORAGE_KEY, customPaths[0]);
    }
  }, [customPaths, customCurrent]);

  const select = useCallback(
    (name: string | null) => {
      if (source === "custom") {
        setCustomCurrent(name);
        writeLS(WALLPAPER_CUSTOM_SELECTION_STORAGE_KEY, name ?? "");
      } else {
        setDefaultCurrent(name);
        writeLS(WALLPAPER_SELECTION_STORAGE_KEY, name ?? "");
      }
    },
    [source],
  );

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

  const setSource = useCallback((nextSource: WallpaperSource) => {
    setSourceState(nextSource);
    writeLS(WALLPAPER_SOURCE_STORAGE_KEY, nextSource);
  }, []);

  const applyCustomPaths = useCallback(
    (paths: string[], folder: string | null) => {
      setCustomPaths(paths);
      writeLS(WALLPAPER_CUSTOM_PATHS_STORAGE_KEY, JSON.stringify(paths));
      setCustomFolder(folder);
      writeLS(WALLPAPER_CUSTOM_FOLDER_STORAGE_KEY, folder ?? "");
      setSourceState("custom");
      writeLS(WALLPAPER_SOURCE_STORAGE_KEY, "custom");
      const first = paths[0] ?? null;
      setCustomCurrent(first);
      writeLS(WALLPAPER_CUSTOM_SELECTION_STORAGE_KEY, first ?? "");
    },
    [],
  );

  const addCustomFiles = useCallback(async () => {
    try {
      const picked = await open({
        multiple: true,
        directory: false,
        filters: [
          { name: "Images", extensions: [...WALLPAPER_IMAGE_EXTENSIONS] },
        ],
      });
      if (!picked) return;
      const chosen = (Array.isArray(picked) ? picked : [picked]).filter(
        (p): p is string => typeof p === "string",
      );
      if (chosen.length === 0) return;
      // Append to any existing custom list, de-duplicating while keeping order.
      const merged = Array.from(new Set([...customPaths, ...chosen]));
      applyCustomPaths(merged, null);
      // Prefer selecting the first newly-added image.
      setCustomCurrent(chosen[0]);
      writeLS(WALLPAPER_CUSTOM_SELECTION_STORAGE_KEY, chosen[0]);
    } catch (err) {
      console.error("[wallpaper] addCustomFiles failed:", err);
    }
  }, [customPaths, applyCustomPaths]);

  const addCustomFolder = useCallback(async () => {
    try {
      const picked = await open({ multiple: false, directory: true });
      if (!picked || typeof picked !== "string") return;
      const images = await invoke<string[]>("list_folder_images", {
        dir: picked,
      });
      // Switch to custom and remember the folder even if it was empty.
      applyCustomPaths(images ?? [], picked);
    } catch (err) {
      console.error("[wallpaper] addCustomFolder failed:", err);
    }
  }, [applyCustomPaths]);

  const clearCustom = useCallback(() => {
    setCustomPaths([]);
    setCustomCurrent(null);
    setCustomFolder(null);
    writeLS(WALLPAPER_CUSTOM_PATHS_STORAGE_KEY, "[]");
    writeLS(WALLPAPER_CUSTOM_SELECTION_STORAGE_KEY, "");
    writeLS(WALLPAPER_CUSTOM_FOLDER_STORAGE_KEY, "");
    setSourceState("default");
    writeLS(WALLPAPER_SOURCE_STORAGE_KEY, "default");
  }, []);

  const enabled = current != null;
  const currentLabel = wallpaperBaseName(current);
  const hasCustom = customPaths.length > 0;

  return useMemo(
    () => ({
      source,
      names,
      current,
      currentLabel,
      enabled,
      random,
      autoSwitch,
      intervalId,
      hasCustom,
      customFolder,
      select,
      next,
      prev,
      toggleEnabled,
      toggleRandom,
      toggleAutoSwitch,
      setIntervalId,
      setSource,
      addCustomFiles,
      addCustomFolder,
      clearCustom,
    }),
    [
      source,
      names,
      current,
      currentLabel,
      enabled,
      random,
      autoSwitch,
      intervalId,
      hasCustom,
      customFolder,
      select,
      next,
      prev,
      toggleEnabled,
      toggleRandom,
      toggleAutoSwitch,
      setIntervalId,
      setSource,
      addCustomFiles,
      addCustomFolder,
      clearCustom,
    ],
  );
}
