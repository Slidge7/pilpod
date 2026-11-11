/** Pure rules for the tab control panel. */

/** A seek target `delta` seconds from `position`, kept inside the media. */
export function seekBy(position: number, delta: number, duration: number): number {
  const end = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.min(end, Math.max(0, position + delta));
}

/** `"3:07"`, `"1:02:45"`; `"0:00"` for anything unknown. */
export function clock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Live streams report no (or an infinite) duration: no seek bar for them. */
export function isSeekable(duration: number | null | undefined, canSeek: boolean | undefined): boolean {
  return canSeek !== false && duration != null && Number.isFinite(duration) && duration > 0;
}

/**
 * A collection name for "save this window's tabs":
 * `"Personal · Window 2 · 30 Oct"`. The date keeps repeated saves apart.
 */
export function windowCollectionName(browserLabel: string, windowLabel: string, at: Date): string {
  const day = at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return [browserLabel.trim(), windowLabel.trim(), day].filter(Boolean).join(" · ");
}

/** Only web pages can be bookmarked (the vault rejects anything else). */
export function isSavableUrl(url: string | null | undefined): boolean {
  return /^https?:\/\//i.test(url ?? "");
}
