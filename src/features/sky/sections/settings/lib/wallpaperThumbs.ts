import { invoke } from "@tauri-apps/api/core";
import type { AppearanceMode } from "../../../../../theme/appearance";
import type { WallpaperSource } from "../../../../media-dashboard";
import { createLimiter } from "./limit";

/**
 * Small previews of wallpapers, for the settings gallery only.
 *
 * Sky never shows a wallpaper behind itself; it only needs thumbnails to pick
 * one. Each image is read once through the same commands the dashboard uses,
 * decoded at reduced size, re-encoded as a ~360px WebP and kept as an object
 * URL for the life of the window — so revisiting the page costs nothing, and
 * no full-size image stays in memory.
 */

const THUMB_WIDTH = 360;
const run = createLimiter(2);
const cache = new Map<string, Promise<string | null>>();

function cacheKey(source: WallpaperSource, name: string, mode: AppearanceMode): string {
  // Custom images are one file for both themes; bundled ones have a variant per theme.
  return source === "custom" ? `custom:${name}` : `default:${mode}:${name}`;
}

async function shrink(dataUrl: string): Promise<string> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: THUMB_WIDTH,
      resizeQuality: "medium",
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const small = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
    return URL.createObjectURL(small);
  } catch {
    // A format the decoder cannot resize (e.g. SVG): show it as it is.
    return dataUrl;
  }
}

async function load(source: WallpaperSource, name: string, mode: AppearanceMode) {
  const raw =
    source === "custom"
      ? await invoke<string | null>("read_image_file", { path: name })
      : await invoke<string | null>("read_wallpaper", { mode, name });
  return raw ? shrink(raw) : null;
}

/** A preview URL for one wallpaper, or `null` when it cannot be read. */
export function wallpaperThumb(
  source: WallpaperSource,
  name: string,
  mode: AppearanceMode,
): Promise<string | null> {
  const key = cacheKey(source, name, mode);
  let entry = cache.get(key);
  if (!entry) {
    entry = run(() => load(source, name, mode)).catch(() => null);
    cache.set(key, entry);
  }
  return entry;
}
