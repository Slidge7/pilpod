import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppearanceMode } from "../../../theme/appearance";
import {
  useWallpaperSettings,
  wallpaperIntervalMs,
  type WallpaperSettings,
} from "./useWallpaperSettings";

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

export type WallpaperController = WallpaperSettings & {
  /** Data URL of the current wallpaper (matched to appearance), or null. */
  dataUrl: string | null;
};

/**
 * The dashboard's wallpaper: the shared preferences ({@link useWallpaperSettings})
 * plus what only the window that *shows* a wallpaper needs — loading the
 * image and running the auto-switch timer. Windows that only edit the
 * wallpaper (PilPod Sky) use the settings hook alone, so they never load an
 * image or advance the rotation a second time.
 */
export function useWallpaper(appearance: AppearanceMode): WallpaperController {
  const settings = useWallpaperSettings();
  const { source, current, names, enabled, autoSwitch, intervalId, next } = settings;
  const [dataUrl, setDataUrl] = useState<string | null>(null);

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

  // Auto-switch timer. A ref keeps the advance fn current without resetting
  // the timer on every wallpaper change.
  const advanceRef = useRef(next);
  advanceRef.current = next;

  const canAuto = autoSwitch && enabled && names.length > 1;
  const ms = wallpaperIntervalMs(intervalId);

  useEffect(() => {
    if (!canAuto) return;
    const timer = window.setInterval(() => advanceRef.current(), ms);
    return () => window.clearInterval(timer);
  }, [canAuto, ms]);

  return useMemo(() => ({ ...settings, dataUrl }), [settings, dataUrl]);
}
