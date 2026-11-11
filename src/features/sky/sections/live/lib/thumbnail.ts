import type { BrowserTab } from "../../../../../types/media";
import { faviconFromUrl, tabSiteHost } from "../../../../media-dashboard";
import { hueFor } from "../../../ui/hue";

export { hueFor };

/**
 * What a tab card shows as its picture.
 *
 * The extension only reports two images for a tab: the media session's
 * artwork (when something is playing) and the page favicon. That leaves most
 * cards with a 16-pixel icon to stretch over a 16:9 frame, so this module adds
 * the one high-value source it can derive offline — YouTube's own video
 * thumbnails, keyed by the id in the URL — and otherwise falls back to a tile
 * built from the favicon and a stable per-site colour.
 */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);
/** Path prefixes whose next segment is the video id (`/shorts/<id>`, …). */
const YOUTUBE_ID_PATHS = ["shorts", "embed", "live", "v"];

/** The 11-character video id of a YouTube URL, or `null` for anything else. */
export function youtubeVideoId(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();

  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = url.pathname.split("/")[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [first, second] = url.pathname.split("/").filter(Boolean);
    if (first === "watch") candidate = url.searchParams.get("v");
    else if (first && YOUTUBE_ID_PATHS.includes(first))
      candidate = second ?? null;
  }

  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

/**
 * Candidate images for a tab's thumbnail, best first. The card tries them in
 * order and falls back to {@link tabIconTile} once all have failed to load.
 */
export function tabThumbnailSources(tab: BrowserTab): string[] {
  const sources: string[] = [];
  const artwork = tab.media?.artworkUrl?.trim();
  if (artwork) sources.push(artwork);
  const videoId = youtubeVideoId(tab.url);
  if (videoId) sources.push(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
  return [...new Set(sources)];
}

export type IconTile = {
  /** Favicon to centre on the tile; `null` shows the letter instead. */
  iconUrl: string | null;
  letter: string;
  /** 0–359. Stable per site, so every tab of one site shares a colour. */
  hue: number;
};

/** The fallback picture: favicon (or initial) on a per-site colour. */
export function tabIconTile(tab: BrowserTab): IconTile {
  const reported = (tab.favIconUrl ?? tab.faviconUrl ?? "").trim();
  const iconUrl =
    reported && !reported.startsWith("chrome://")
      ? reported
      : faviconFromUrl(tab.url);
  const host = tabSiteHost(tab);
  const letter =
    (host ?? tab.title?.trim() ?? "?").charAt(0).toUpperCase() || "?";
  return { iconUrl, letter, hue: hueFor(host ?? tab.title ?? "") };
}
