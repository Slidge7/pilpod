import { useEffect, useRef, useState } from "react";
import type { BrowserTab } from "../../../types/media";
import { tabHasActiveMedia } from "../lib/browserMedia";

/**
 * Keeps a tab classified as "media" briefly after its media disappears.
 *
 * When a media tab reloads or navigates (e.g. YouTube next/prev), its content
 * script is torn down and the media snapshot goes null for a second or two —
 * which would otherwise drop the row out of the media list and then pop it back
 * in. This hook remembers each tab's last active media for `graceMs` and, while
 * the tab has no live media within that window, substitutes the remembered
 * snapshot so the row stays in place until the reload settles (or truly ends).
 *
 * Tabs that never had media, and tabs past the grace window, pass through
 * untouched.
 */
export function useStickyMedia<B extends { id: string; tabs: BrowserTab[] }>(
  browsers: readonly B[],
  graceMs: number,
): B[] {
  const cacheRef = useRef<Map<string, { media: NonNullable<BrowserTab["media"]>; expires: number }>>(
    new Map(),
  );
  const [, tick] = useState(0);

  const now = Date.now();
  let nextExpiry = Infinity;

  const result = browsers.map((b) => {
    let changed = false;
    const tabs = b.tabs.map((t) => {
      const key = `${b.id}:${t.tabId}`;
      if (tabHasActiveMedia(t) && t.media) {
        cacheRef.current.set(key, { media: t.media, expires: now + graceMs });
        return t;
      }
      const cached = cacheRef.current.get(key);
      if (cached && cached.expires > now) {
        nextExpiry = Math.min(nextExpiry, cached.expires);
        changed = true;
        return { ...t, media: cached.media };
      }
      if (cached) cacheRef.current.delete(key);
      return t;
    });
    return changed ? { ...b, tabs } : b;
  });

  // Re-render when the soonest cached entry expires so a stopped tab finally drops.
  useEffect(() => {
    if (nextExpiry === Infinity) return;
    const id = setTimeout(
      () => tick((n) => n + 1),
      Math.max(0, nextExpiry - Date.now()) + 50,
    );
    return () => clearTimeout(id);
  });

  return result;
}
