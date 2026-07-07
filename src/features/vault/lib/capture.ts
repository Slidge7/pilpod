/**
 * Capture helpers: turn the `BrowserTab` + `DetectedBrowser` data the frontend
 * already holds (from `browsers://update`) into the camelCase payloads the
 * vault commands expect. The backend never reaches into browser state itself —
 * these payloads are the entire interface (isolation contract).
 */

import type { BrowserTab } from "../../../types/media";
import { faviconFromUrl } from "../../media-dashboard/lib/browserMedia";
import type { AddBookmarkArgs, AddMediaArgs, MediaKind } from "../types";

/** Minimal browser provenance the capture functions need. */
export interface CaptureBrowser {
  osBrowserId?: string;
  displayName?: string;
  profileLabel?: string | null;
}

const AUDIO_EXTENSIONS = [".mp3", ".aac", ".flac", ".wav", ".ogg"];
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".m3u8", ".mpd"];

/** Rule-id / host fragments that imply audio-only playback. */
const AUDIO_HINTS = [
  "spotify", "podcast", "apple-podcasts", "deezer", "bandcamp", "mixcloud",
  "soundcloud", "music", "audiomack", "tidal",
];

/**
 * Classify a media entry as "video" | "audio" | "unknown" from its URL and the
 * companion's `mediaMatchRule`. Conservative: unknown when nothing matches.
 */
export function deriveMediaKind(
  url: string,
  mediaMatchRule?: string | null,
): MediaKind {
  const rule = (mediaMatchRule ?? "").toLowerCase();
  const u = (url ?? "").toLowerCase();

  const path = (() => {
    try {
      return new URL(u).pathname.toLowerCase();
    } catch {
      return u;
    }
  })();

  if (AUDIO_EXTENSIONS.some((e) => path.endsWith(e))) return "audio";
  if (VIDEO_EXTENSIONS.some((e) => path.endsWith(e))) return "video";

  const haystack = `${rule} ${u}`;
  if (AUDIO_HINTS.some((h) => haystack.includes(h))) return "audio";

  // Anything else that reached the media pipeline is most likely video.
  if (rule.length > 0) return "video";
  return "unknown";
}

/** Best favicon for a tab: extension-provided, then a derived fallback. */
export function bestFavicon(tab: BrowserTab): string | null {
  return (
    tab.favIconUrl?.trim() ||
    tab.faviconUrl?.trim() ||
    faviconFromUrl(tab.url ?? "") ||
    null
  );
}

/** `BrowserTab` (+ optional browser provenance) → add-bookmark payload. */
export function captureBookmark(
  tab: BrowserTab,
  browser?: CaptureBrowser,
): AddBookmarkArgs {
  return {
    url: tab.url ?? "",
    title: tab.title?.trim() || null,
    faviconUrl: bestFavicon(tab),
    sourceOsBrowserId: browser?.osBrowserId ?? null,
    sourceProfileLabel: browser?.profileLabel ?? null,
  };
}

/** `BrowserTab` (with `media`) → add-media-to-playlist payload. */
export function captureMedia(
  tab: BrowserTab,
  browser?: CaptureBrowser,
): AddMediaArgs {
  const m = tab.media ?? null;
  const url = tab.url ?? "";
  return {
    url,
    pageTitle: tab.title?.trim() || null,
    mediaTitle: m?.title?.trim() || null,
    artist: m?.artist?.trim() || null,
    album: m?.album?.trim() || null,
    artworkUrl: m?.artworkUrl?.trim() || null,
    durationSecs: m?.duration != null && m.duration > 0 ? m.duration : null,
    mediaMatchRule: m?.mediaMatchRule?.trim() || null,
    kind: deriveMediaKind(url, m?.mediaMatchRule),
    sourceOsBrowserId: browser?.osBrowserId ?? null,
  };
}
