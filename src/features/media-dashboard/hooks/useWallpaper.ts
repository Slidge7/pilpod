import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WALLPAPER_PATH_STORAGE_KEY } from "../constants";

type WallpaperData = {
  path: string;
  dataUrl: string;
};

function readStoredPath(): string | null {
  try {
    return localStorage.getItem(WALLPAPER_PATH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistPath(path: string | null) {
  try {
    if (path) localStorage.setItem(WALLPAPER_PATH_STORAGE_KEY, path);
    else localStorage.removeItem(WALLPAPER_PATH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function useWallpaper() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const path = readStoredPath();
    if (!path) return;
    let cancelled = false;
    void invoke<string | null>("read_wallpaper", { path })
      .then((url) => {
        if (cancelled) return;
        if (url) {
          setDataUrl(url);
        } else {
          persistPath(null);
        }
      })
      .catch(() => {
        /* file missing or unreadable — leave wallpaper unset */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pickWallpaper = useCallback(async () => {
    try {
      const result = await invoke<WallpaperData | null>("pick_wallpaper");
      if (result) {
        setDataUrl(result.dataUrl);
        persistPath(result.path);
      }
    } catch (err) {
      console.error("[wallpaper] pick_wallpaper failed:", err);
    }
  }, []);

  const clearWallpaper = useCallback(() => {
    setDataUrl(null);
    persistPath(null);
  }, []);

  return {
    wallpaper: dataUrl,
    hasWallpaper: dataUrl != null,
    pickWallpaper,
    clearWallpaper,
  };
}
