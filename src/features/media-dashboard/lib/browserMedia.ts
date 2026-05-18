import type { BrowserTab, TabMedia } from "../../../types/media";

/** Show idle hint on media tabs when user inactive longer than this. */
export const USER_IDLE_WARN_MS = 300_000;

/** Tab lifecycle badge label (sleeping / crashed / loading). */
export function tabStateBadge(tabState?: string): string | null {
  const s = (tabState ?? "").toLowerCase();
  if (s === "sleeping") return "💤";
  if (s === "crashed") return "⚠️";
  if (s === "loading") return "⏳";
  return null;
}

/** True when the tab has active media that is currently playing. */
export function isTabPlaying(t: BrowserTab): boolean {
  return t.media?.playbackState === "playing";
}

/** True when the tab has any active media (playing or paused). */
export function tabHasMedia(t: BrowserTab): boolean {
  if (t.media == null) return false;
  const state = (t.media.playbackState ?? "").toLowerCase();
  if (state === "playing" || state === "paused") return true;
  // MediaSession / element detected but playback state not resolved yet.
  if ((t.media.title?.trim() ?? "").length > 0) return true;
  if ((t.media.artist?.trim() ?? "").length > 0) return true;
  return (t.media.duration ?? 0) > 0;
}

/** Stable pending key for any browser tab row. */
export function tabRowKey(t: BrowserTab): string {
  return `tab:${t.browserId ?? ""}:${t.tabId}`;
}

export function abbreviatedUrl(url: string, max = 52): string {
  const u = url.trim();
  if (u.length <= max) return u;
  return `${u.slice(0, Math.max(0, max - 1))}…`;
}

/** Best-effort favicon URL via Google's favicon service. */
export function faviconFromUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(u.hostname)}`;
  } catch {
    return null;
  }
}

/** Format seconds as MM:SS / H:MM:SS. */
export function formatMediaSeconds(secs: number): string {
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Artist field from tab media. */
export function mediaArtist(m: TabMedia): string | null {
  return m.artist?.trim() || null;
}

/** Time label ("1:23 / 4:56") from tab media, if available. */
export function mediaTimeLabel(m: TabMedia): string | null {
  const dur = m.duration != null && m.duration > 0 ? m.duration : null;
  if (dur == null) return null;
  const pos = m.currentTime != null && m.currentTime >= 0 ? m.currentTime : 0;
  return `${formatMediaSeconds(pos)} / ${formatMediaSeconds(dur)}`;
}
