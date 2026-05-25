/**
 * Static media host patterns — authoritative source for manifest content_scripts
 * and discovery-engine static coverage checks.
 */

"use strict";

/** Unique media hosts from v1 mediaUrlRules + special cases + v2 spec additions. */
const STATIC_MEDIA_HOSTS = [
  // v1 RULES hosts
  "youtube.com",
  "youtu.be",
  "music.youtube.com",
  "open.spotify.com",
  "vimeo.com",
  "twitch.tv",
  "clips.twitch.tv",
  "netflix.com",
  "primevideo.com",
  "amazon.com",
  "disneyplus.com",
  "hulu.com",
  "max.com",
  "play.max.com",
  "tv.apple.com",
  "plex.tv",
  "crunchyroll.com",
  "dailymotion.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "vk.com",
  "bilibili.com",
  "odysee.com",
  "bbc.co.uk",
  "podcasts.apple.com",
  "podcast.spotify.com",
  "deezer.com",
  "bandcamp.com",
  "mixcloud.com",
  "audiomack.com",
  "player.fm",
  "archive.org",
  "ted.com",
  "coursera.org",
  "udemy.com",
  "linkedin.com",
  "skillshare.com",
  "loom.com",
  "wistia.com",
  // v1 special-case hosts
  "soundcloud.com",
  "kick.com",
  "rumble.com",
  "tiktok.com",
  // v2 spec additions
  "youtube-nocookie.com",
  "player.twitch.tv",
  "listen.tidal.com",
  "iqiyi.com",
  "shahid.mbc.net",
  "dazn.com",
  "espn.com",
  "plus.rtl.de",
  "joyn.de",
  "globoplay.globo.com",
  "hotstar.com",
  "spotify.com",
];

/**
 * @param {string} hostname
 * @returns {string}
 */
function normalizeHostname(hostname) {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

/**
 * @param {string} urlString
 * @returns {string | null}
 */
export function hostnameFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return normalizeHostname(url.hostname);
  } catch {
    return null;
  }
}

/**
 * @param {string} hostname
 * @param {string} host
 * @returns {boolean}
 */
export function hostnameMatchesHost(hostname, host) {
  const h = normalizeHostname(hostname);
  const rule = host.toLowerCase();
  return h === rule || h.endsWith(`.${rule}`);
}

/**
 * @param {string} domain
 * @returns {string[]}
 */
export function originPatternsForDomain(domain) {
  const d = normalizeHostname(domain.replace(/^\.+/, ""));
  return [`*://*.${d}/*`, `*://${d}/*`];
}

/**
 * @param {string} host
 * @returns {string[]}
 */
export function matchPatternsForHost(host) {
  return originPatternsForDomain(host);
}

/** @type {readonly string[]} */
export const STATIC_MEDIA_MATCHES = Object.freeze(
  STATIC_MEDIA_HOSTS.flatMap((host) => matchPatternsForHost(host)),
);

/**
 * @param {string} urlString
 * @returns {boolean}
 */
export function urlMatchesStaticPatterns(urlString) {
  const hostname = hostnameFromUrl(urlString);
  if (!hostname) return false;
  return STATIC_MEDIA_HOSTS.some((host) => hostnameMatchesHost(hostname, host));
}

/**
 * @param {string} domain
 * @returns {boolean}
 */
export function isValidDomain(domain) {
  const d = normalizeHostname(String(domain ?? "").trim());
  if (!d || d.length > 253) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d);
}

export { STATIC_MEDIA_HOSTS };
