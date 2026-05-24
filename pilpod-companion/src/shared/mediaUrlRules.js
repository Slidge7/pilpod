/**
 * Media URL allowlist — authoritative source for "is this a media page?"
 *
 * Open decisions (resolved):
 * - Background audio: active || audible (handled in mediaGate.js, not here)
 * - Broad hosts (soundcloud.com, kick.com, rumble.com): path-prefix only (stricter)
 * - Injection: universal inject + early return in content script
 */

"use strict";

/** @type {readonly string[]} */
const DIRECT_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mp3",
  ".aac",
  ".flac",
  ".wav",
  ".ogg",
  ".m3u8",
  ".mpd",
];

/**
 * @typedef {object} HostPathRule
 * @property {string} id
 * @property {string} host
 * @property {string} [path] - If set, pathname must start with this prefix.
 */

/** @type {readonly HostPathRule[]} */
const RULES = [
  { id: "youtube-watch", host: "youtube.com", path: "/watch" },
  { id: "youtube-shorts", host: "youtube.com", path: "/shorts" },
  { id: "youtu-be", host: "youtu.be" },
  { id: "youtube-music", host: "music.youtube.com" },
  { id: "spotify-track", host: "open.spotify.com", path: "/track" },
  { id: "spotify-episode", host: "open.spotify.com", path: "/episode" },
  { id: "spotify-playlist", host: "open.spotify.com", path: "/playlist" },
  { id: "vimeo", host: "vimeo.com" },
  { id: "twitch", host: "twitch.tv" },
  { id: "twitch-clips", host: "clips.twitch.tv" },
  { id: "netflix", host: "netflix.com", path: "/watch" },
  { id: "primevideo", host: "primevideo.com" },
  { id: "amazon-video", host: "amazon.com", path: "/gp/video" },
  { id: "disneyplus", host: "disneyplus.com", path: "/video" },
  { id: "disneyplus-play", host: "disneyplus.com", path: "/play" },
  { id: "hulu", host: "hulu.com", path: "/watch" },
  { id: "max", host: "max.com", path: "/video" },
  { id: "play-max", host: "play.max.com" },
  { id: "apple-tv", host: "tv.apple.com" },
  { id: "plex", host: "plex.tv", path: "/web" },
  { id: "crunchyroll", host: "crunchyroll.com", path: "/watch" },
  { id: "dailymotion", host: "dailymotion.com", path: "/video" },
  { id: "facebook-watch", host: "facebook.com", path: "/watch" },
  { id: "facebook-reel", host: "facebook.com", path: "/reel" },
  { id: "instagram-reel", host: "instagram.com", path: "/reel" },
  { id: "instagram-p", host: "instagram.com", path: "/p/" },
  { id: "x-spaces", host: "x.com", path: "/i/spaces" },
  { id: "twitter-spaces", host: "twitter.com", path: "/i/spaces" },
  { id: "vk-video", host: "vk.com", path: "/video" },
  { id: "bilibili", host: "bilibili.com", path: "/video" },
  { id: "odysee", host: "odysee.com" },
  { id: "bbc-iplayer", host: "bbc.co.uk", path: "/iplayer" },
  { id: "apple-podcasts", host: "podcasts.apple.com" },
  { id: "spotify-podcast", host: "podcast.spotify.com" },
  { id: "deezer-track", host: "deezer.com", path: "/track" },
  { id: "bandcamp", host: "bandcamp.com", path: "/track" },
  { id: "mixcloud", host: "mixcloud.com" },
  { id: "audiomack", host: "audiomack.com" },
  { id: "player-fm", host: "player.fm" },
  { id: "archive-org", host: "archive.org", path: "/details" },
  { id: "ted-talks", host: "ted.com", path: "/talks" },
  { id: "coursera-lecture", host: "coursera.org", path: "/lecture" },
  { id: "udemy-course", host: "udemy.com", path: "/course" },
  { id: "linkedin-learning", host: "linkedin.com", path: "/learning" },
  { id: "skillshare", host: "skillshare.com", path: "/classes" },
  { id: "loom", host: "loom.com", path: "/share" },
  { id: "wistia", host: "wistia.com", path: "/medias" },
];

/** @type {readonly string[]} */
const SOUNDCLOUD_EXCLUDED_PREFIXES = [
  "/discover",
  "/stream",
  "/you",
  "/charts",
  "/signin",
  "/pages",
];

const KICK_EXCLUDED_SEGMENTS = new Set([
  "browse",
  "categories",
  "directory",
  "login",
  "signup",
  "about",
  "terms",
  "privacy",
]);

const TIKTOK_VIDEO_RE = /tiktok\.com\/@[^/]+\/video\//;

/**
 * @param {string} hostname
 * @returns {string}
 */
function normalizeHostname(hostname) {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

/**
 * @param {string} urlString
 * @returns {{ hostname: string, pathname: string, pathAndSearch: string } | null}
 */
function parseUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return {
      hostname: normalizeHostname(url.hostname),
      pathname: url.pathname.toLowerCase(),
      pathAndSearch: `${url.pathname}${url.search}`.toLowerCase(),
    };
  } catch {
    return null;
  }
}

/**
 * @param {string} pathAndSearch
 * @returns {string | null}
 */
function matchDirectExtension(pathAndSearch) {
  for (const ext of DIRECT_EXTENSIONS) {
    if (pathAndSearch.includes(ext)) {
      return `direct-${ext.slice(1)}`;
    }
  }
  return null;
}

/**
 * @param {string} hostname
 * @param {string} pathname
 * @returns {string | null}
 */
function matchSoundCloud(hostname, pathname) {
  if (hostname !== "soundcloud.com") return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  for (const prefix of SOUNDCLOUD_EXCLUDED_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return null;
  }
  return "soundcloud-track";
}

/**
 * @param {string} hostname
 * @param {string} pathname
 * @returns {string | null}
 */
function matchKick(hostname, pathname) {
  if (hostname !== "kick.com") return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  if (KICK_EXCLUDED_SEGMENTS.has(segments[0])) return null;
  return "kick-stream";
}

/**
 * @param {string} hostname
 * @param {string} pathname
 * @returns {string | null}
 */
function matchRumble(hostname, pathname) {
  if (hostname !== "rumble.com") return null;
  if (pathname.startsWith("/embed/")) return "rumble-video";
  if (pathname.startsWith("/v/")) return "rumble-video";
  if (/^\/v[^/]/.test(pathname)) return "rumble-video";
  return null;
}

/**
 * @param {string} hostname
 * @param {string} pathname
 * @returns {string | null}
 */
function matchHostPathRules(hostname, pathname) {
  for (const rule of RULES) {
    if (hostname !== rule.host) continue;
    if (rule.path && !pathname.startsWith(rule.path)) continue;
    return rule.id;
  }
  return null;
}

/**
 * @param {string} hostname
 * @param {string} pathname
 * @returns {string | null}
 */
function matchTikTok(hostname, pathname) {
  const hostPath = `${hostname}${pathname}`;
  if (TIKTOK_VIDEO_RE.test(hostPath)) return "tiktok-video";
  return null;
}

/**
 * Returns the rule ID that matched, or null.
 * @param {string} urlString
 * @returns {string | null}
 */
export function matchMediaUrlRule(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const { hostname, pathname, pathAndSearch } = parsed;

  const direct = matchDirectExtension(pathAndSearch);
  if (direct) return direct;

  const hostPath = matchHostPathRules(hostname, pathname);
  if (hostPath) return hostPath;

  const soundcloud = matchSoundCloud(hostname, pathname);
  if (soundcloud) return soundcloud;

  const kick = matchKick(hostname, pathname);
  if (kick) return kick;

  const rumble = matchRumble(hostname, pathname);
  if (rumble) return rumble;

  return matchTikTok(hostname, pathname);
}

/**
 * Returns true if the given URL string is on the media allowlist.
 * @param {string} urlString
 * @returns {boolean}
 */
export function isMediaUrl(urlString) {
  return matchMediaUrlRule(urlString) !== null;
}
