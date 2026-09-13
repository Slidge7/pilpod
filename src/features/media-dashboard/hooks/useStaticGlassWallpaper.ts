import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Static glassmorphism — GPU memory fix.
 *
 * The dashboard wallpaper is a *static* image pinned to the viewport
 * (background-attachment: fixed, center / cover). That means for every glass
 * element, `backdrop-filter: blur(σ)` produces exactly the pixels of a
 * pre-blurred copy of the wallpaper, viewed through the same viewport-fixed
 * window and clipped to the element.
 *
 * Instead of letting Chromium keep dozens of live backdrop-filter nodes —
 * each one forcing intermediate off-screen VRAM textures and a blur pass per
 * frame — we blur the wallpaper ONCE per (wallpaper, radius, viewport) on an
 * offscreen canvas and let every glass surface paint a slice of that shared,
 * already-blurred texture via `background-attachment: fixed`. Rendered output
 * is identical; VRAM cost drops from GBs of per-element surfaces to two
 * viewport-sized images.
 *
 * CSS custom properties produced (consumed by the `--glass-static` overrides
 * in glass-float-shell.css, BrowserSessionsPanel.css):
 *   --pilpod-wpb-float  wallpaper blurred at the float radius (4px · strength)
 *   --pilpod-wpb-panel  wallpaper blurred at the fixed panel radius (12px)
 *
 * Fidelity notes:
 * - CSS blur(<length>) and canvas ctx.filter use the same Gaussian σ, so the
 *   blur amount matches backdrop-filter exactly.
 * - Edges are replicated (clamp-to-edge) before blurring, matching how the
 *   compositor samples the backdrop at the window boundary — no dark vignette.
 * - Everything is generated in device pixels, so DPI scaling matches too.
 */

/** Fixed radius used by panels that hard-code blur(12px). */
const PANEL_RADIUS_PX = 12;
/** Max float radius (scaled by glass strength, mirrors applyGlassStrength). */
const FLOAT_RADIUS_MAX_PX = 4;
/** Debounce for regeneration (resize / strength slider). */
const REGEN_DEBOUNCE_MS = 150;

export type StaticGlassWallpaper = {
  /** True once blurred textures exist for the current wallpaper. */
  ready: boolean;
  /** Style vars to spread onto the dashboard shell inner element. */
  styleVars: CSSProperties;
};

type Viewport = { w: number; h: number; dpr: number };

function readViewport(): Viewport {
  return {
    w: Math.max(1, window.innerWidth),
    h: Math.max(1, window.innerHeight),
    dpr: window.devicePixelRatio || 1,
  };
}

/**
 * Draw `img` cover-fitted to a W×H viewport, replicate its edges into a
 * `pad` margin (clamp-to-edge, like the compositor does at the backdrop
 * boundary), blur the whole thing at `radius` device px, crop the center
 * back to W×H and return an object URL for the result.
 */
async function renderBlurredCover(
  img: ImageBitmap,
  W: number,
  H: number,
  radius: number,
): Promise<string> {
  const pad = radius > 0 ? Math.ceil(radius * 3) : 0;
  const PW = W + pad * 2;
  const PH = H + pad * 2;

  // 1) Sharp, cover-fitted, edge-replicated source.
  const sharp = new OffscreenCanvas(PW, PH);
  const sctx = sharp.getContext("2d")!;
  const scale = Math.max(W / img.width, H / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  sctx.drawImage(img, pad + (W - dw) / 2, pad + (H - dh) / 2, dw, dh);
  if (pad > 0) {
    // Edge strips…
    sctx.drawImage(sharp, pad, pad, W, 1, pad, 0, W, pad); // top
    sctx.drawImage(sharp, pad, pad + H - 1, W, 1, pad, pad + H, W, pad); // bottom
    sctx.drawImage(sharp, pad, pad, 1, H, 0, pad, pad, H); // left
    sctx.drawImage(sharp, pad + W - 1, pad, 1, H, pad + W, pad, pad, H); // right
    // …and corners.
    sctx.drawImage(sharp, pad, pad, 1, 1, 0, 0, pad, pad);
    sctx.drawImage(sharp, pad + W - 1, pad, 1, 1, pad + W, 0, pad, pad);
    sctx.drawImage(sharp, pad, pad + H - 1, 1, 1, 0, pad + H, pad, pad);
    sctx.drawImage(sharp, pad + W - 1, pad + H - 1, 1, 1, pad + W, pad + H, pad, pad);
  }

  // 2) Blur (same Gaussian σ semantics as backdrop-filter: blur()).
  const blurred = new OffscreenCanvas(PW, PH);
  const bctx = blurred.getContext("2d")!;
  if (radius > 0.1) bctx.filter = `blur(${radius}px)`;
  bctx.drawImage(sharp, 0, 0);

  // 3) Crop the padding away.
  const out = new OffscreenCanvas(W, H);
  out.getContext("2d")!.drawImage(blurred, -pad, -pad);

  const blob = await out.convertToBlob({ type: "image/png" });
  return URL.createObjectURL(blob);
}

type TextureEntry = {
  floatUrl: string;
  panelUrl: string;
};

export type { TextureEntry, Viewport };
export const MAX_CACHE_ENTRIES = 16;
export const textureCache = new Map<string, TextureEntry>();

export function makeCacheKey(url: string, radiusCss: number, vp: Viewport): string {
  return `${url}:${radiusCss.toFixed(2)}:${vp.w}x${vp.h}:${vp.dpr}`;
}

export function addToCache(key: string, entry: TextureEntry, protectedUrls: Set<string>) {
  if (textureCache.has(key)) return;
  if (textureCache.size >= MAX_CACHE_ENTRIES) {
    for (const [oldKey, oldEntry] of textureCache.entries()) {
      if (!protectedUrls.has(oldEntry.floatUrl) && !protectedUrls.has(oldEntry.panelUrl)) {
        URL.revokeObjectURL(oldEntry.floatUrl);
        URL.revokeObjectURL(oldEntry.panelUrl);
        textureCache.delete(oldKey);
        break;
      }
    }
  }
  textureCache.set(key, entry);
}

async function generateEntry(
  url: string,
  radiusCss: number,
  vp: Viewport,
  protectedUrls: Set<string>,
): Promise<TextureEntry | null> {
  const key = makeCacheKey(url, radiusCss, vp);
  const cached = textureCache.get(key);
  if (cached) return cached;

  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const W = Math.round(vp.w * vp.dpr);
    const H = Math.round(vp.h * vp.dpr);
    const floatUrl = await renderBlurredCover(bitmap, W, H, radiusCss * vp.dpr);
    const panelUrl = await renderBlurredCover(bitmap, W, H, PANEL_RADIUS_PX * vp.dpr);
    bitmap.close();
    if (!floatUrl || !panelUrl) return null;
    const entry: TextureEntry = { floatUrl, panelUrl };
    addToCache(key, entry, protectedUrls);
    return entry;
  } catch (err) {
    console.error("[glass] texture generation failed:", err);
    return null;
  }
}

export function useStaticGlassWallpaper(
  currentUrl: string | null,
  glassStrengthPct: number,
): StaticGlassWallpaper {
  const [styleVars, setStyleVars] = useState<CSSProperties | null>(null);
  const [viewport, setViewport] = useState<Viewport>(readViewport);
  const liveUrlsRef = useRef<Set<string>>(new Set());
  const lastUrlRef = useRef<string | null>(currentUrl);
  const currentEntryRef = useRef<TextureEntry | null>(null);

  // Track viewport size / DPI (debounced — resizes come in bursts).
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setViewport(readViewport()), REGEN_DEBOUNCE_MS);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const floatRadiusCss =
    (FLOAT_RADIUS_MAX_PX * Math.min(100, Math.max(0, glassStrengthPct))) / 100;

  useEffect(() => {
    if (!currentUrl) {
      currentEntryRef.current = null;
      liveUrlsRef.current.clear();
      setStyleVars(null);
      return;
    }

    let cancelled = false;
    const urlChanged = currentUrl !== lastUrlRef.current;
    lastUrlRef.current = currentUrl;

    // Debounce when dragging slider or resizing window; generate immediately when switching wallpaper.
    const delay = urlChanged ? 0 : REGEN_DEBOUNCE_MS;

    const timer = window.setTimeout(async () => {
      const protectedUrls = liveUrlsRef.current;

      let nextCurrEntry: TextureEntry | null = null;
      const key = makeCacheKey(currentUrl, floatRadiusCss, viewport);
      const cached = textureCache.get(key);
      if (cached) {
        nextCurrEntry = cached;
      } else {
        nextCurrEntry = await generateEntry(currentUrl, floatRadiusCss, viewport, protectedUrls);
      }

      if (cancelled) return;

      currentEntryRef.current = nextCurrEntry;

      const newLiveUrls = new Set<string>();
      const vars: CSSProperties & Record<string, string> = {};

      if (nextCurrEntry) {
        vars["--pilpod-wpb-float" as string] = `url("${nextCurrEntry.floatUrl}")`;
        vars["--pilpod-wpb-panel" as string] = `url("${nextCurrEntry.panelUrl}")`;
        newLiveUrls.add(nextCurrEntry.floatUrl);
        newLiveUrls.add(nextCurrEntry.panelUrl);
      }

      liveUrlsRef.current = newLiveUrls;
      setStyleVars(vars);
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentUrl, floatRadiusCss, viewport]);

  return {
    ready: styleVars != null,
    styleVars: styleVars ?? {},
  };
}
