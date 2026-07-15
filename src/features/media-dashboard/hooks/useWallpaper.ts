import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppearanceMode } from "../../../theme/appearance";
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

/** Last path segment of an absolute path (handles both / and \\ separators). */
function baseName(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(/[/\\]+/);
  return parts[parts.length - 1] || path;
}

/**
 * Normalize a user-picked image for use as a wallpaper (performance guard).
 *
 * Custom images are arbitrary files: a phone photo can be 8000×6000, which
 * Chromium would hold as a ~180 MB uncompressed GPU texture for as long as
 * it is the wallpaper — and its ~30 MB+ base64 data URL would sit in React
 * state and the inline style attribute. Bundled wallpapers are curated so
 * they skip this path entirely.
 *
 * This decodes once, downscales so the long edge fits the physical screen
 * (the wallpaper renders with `cover`, so anything beyond screen resolution
 * is invisible), and re-encodes to a compact blob. Side effect we want:
 * animated GIF/WebP are frozen to their first frame — an animating
 * full-screen background would re-rasterize constantly and desync from the
 * pre-blurred static-glass textures.
 */
async function normalizeCustomWallpaper(rawDataUrl: string): Promise<Blob> {
  const sourceBlob = await (await fetch(rawDataUrl)).blob();
  const bitmap = await createImageBitmap(sourceBlob);
  const dpr = window.devicePixelRatio || 1;
  const cap = Math.max(window.screen.width, window.screen.height, 1280) * dpr;
  const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  // WebP keeps alpha and compresses well; quality 0.95 is visually lossless
  // at display resolution.
  return canvas.convertToBlob({ type: "image/webp", quality: 0.95 });
}

export type WallpaperController = {
  /** Active source: bundled light/dark pairs, or the user's own images. */
  source: WallpaperSource;
  /** Names/paths available in the active source, sorted. */
  names: string[];
  /** Currently selected name/path, or null when the wallpaper is off. */
  current: string | null;
  /** Friendly display label for the current selection (file base name). */
  currentLabel: string | null;
  /** Data URL of the current wallpaper (matched to appearance), or null. */
  dataUrl: string | null;
  enabled: boolean;
  random: boolean;
  autoSwitch: boolean;
  intervalId: WallpaperIntervalId;
  /** True when the user has at least one custom image configured. */
  hasCustom: boolean;
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

export function useWallpaper(appearance: AppearanceMode): WallpaperController {
  const [source, setSourceState] = useState<WallpaperSource>(readStoredSource);

  // Bundled (default) source ------------------------------------------------
  const [bundledNames, setBundledNames] = useState<string[]>([]);
  const [defaultCurrent, setDefaultCurrent] = useState<string | null>(() => {
    const raw = readLS(WALLPAPER_SELECTION_STORAGE_KEY);
    return raw ? raw : null; // "" or missing => off
  });

  // Custom (user) source ----------------------------------------------------
  const [customPaths, setCustomPaths] = useState<string[]>(readStoredCustomPaths);
  const [customCurrent, setCustomCurrent] = useState<string | null>(() => {
    const raw = readLS(WALLPAPER_CUSTOM_SELECTION_STORAGE_KEY);
    return raw ? raw : null;
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

  // Object URL of the current *custom* wallpaper (normalized blob). Tracked so
  // it can be revoked when replaced — otherwise every switch would leak the
  // previous decoded image blob.
  const customObjectUrlRef = useRef<string | null>(null);

  // Load the image for the current selection. For the default source the image
  // is matched to appearance (light/dark variant of the same name). For custom
  // images there is a single file shared by both modes; it is normalized
  // (downscaled + re-encoded) before display — see normalizeCustomWallpaper.
  useEffect(() => {
    const publish = (url: string | null, isObjectUrl: boolean) => {
      if (customObjectUrlRef.current) {
        URL.revokeObjectURL(customObjectUrlRef.current);
      }
      customObjectUrlRef.current = isObjectUrl ? url : null;
      setDataUrl(url);
    };

    if (!current) {
      publish(null, false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        if (source === "custom") {
          const raw = await invoke<string | null>("read_image_file", {
            path: current,
          });
          if (cancelled) return;
          if (!raw) {
            publish(null, false);
            return;
          }
          const blob = await normalizeCustomWallpaper(raw);
          if (cancelled) return;
          publish(URL.createObjectURL(blob), true);
        } else {
          const url = await invoke<string | null>("read_wallpaper", {
            mode: appearance,
            name: current,
          });
          if (cancelled) return;
          publish(url ?? null, false);
        }
      } catch (err) {
        console.error("[wallpaper] read image failed:", err);
        if (!cancelled) publish(null, false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [source, current, appearance]);

  // Revoke the last custom object URL when the hook unmounts.
  useEffect(
    () => () => {
      if (customObjectUrlRef.current) {
        URL.revokeObjectURL(customObjectUrlRef.current);
        customObjectUrlRef.current = null;
      }
    },
    [],
  );

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
    writeLS(WALLPAPER_CUSTOM_PATHS_STORAGE_KEY, "[]");
    writeLS(WALLPAPER_CUSTOM_SELECTION_STORAGE_KEY, "");
    writeLS(WALLPAPER_CUSTOM_FOLDER_STORAGE_KEY, "");
    setSourceState("default");
    writeLS(WALLPAPER_SOURCE_STORAGE_KEY, "default");
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

  const currentLabel = baseName(current);
  const hasCustom = customPaths.length > 0;

  return useMemo(
    () => ({
      source,
      names,
      current,
      currentLabel,
      dataUrl,
      enabled,
      random,
      autoSwitch,
      intervalId,
      hasCustom,
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
      dataUrl,
      enabled,
      random,
      autoSwitch,
      intervalId,
      hasCustom,
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
