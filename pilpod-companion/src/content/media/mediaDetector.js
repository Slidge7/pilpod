/**
 * Page media detection — authoritative detector for content script snapshots.
 */

"use strict";

import { isMediaUrl, matchMediaUrlRule } from "../../shared/mediaUrlRules.js";

function allMediaElements() {
  return [
    ...document.querySelectorAll("video"),
    ...document.querySelectorAll("audio"),
  ];
}

function mediaElementsWithData() {
  return allMediaElements().filter((el) => el.readyState > 0);
}

export function activeMediaElement() {
  const all     = mediaElementsWithData();
  const playing = all.find((el) => !el.paused && !el.ended && el.readyState > 2);
  if (playing) return playing;
  return all.find((el) => el.paused && el.readyState > 0) ?? null;
}

export function resolvePlaybackState() {
  const all = mediaElementsWithData();
  if (all.some((el) => !el.paused && !el.ended && el.readyState > 2)) return "playing";
  if (all.some((el) => el.paused && el.readyState > 0)) return "paused";

  const ms = navigator.mediaSession?.playbackState;
  if (ms === "playing") return "playing";
  if (ms === "paused") return "paused";

  return "none";
}

function resolveHasSignal() {
  const hasPlayingElement = allMediaElements().some(
    (el) => !el.paused && !el.ended && el.readyState > 2,
  );
  const hasPlayingSession = navigator.mediaSession?.playbackState === "playing";
  return hasPlayingElement || hasPlayingSession;
}

export function pickArtworkUrl() {
  const artwork = navigator.mediaSession?.metadata?.artwork ?? [];

  if (artwork.length > 0) {
    let bestSrc = "";
    let bestW   = 0;
    for (const a of artwork) {
      if (!a?.src) continue;
      const w = parseInt(String(a.sizes ?? "").split(/[x×]/)[0], 10) || 0;
      if (w > bestW || !bestSrc) { bestW = w; bestSrc = String(a.src); }
    }
    if (bestSrc) return bestSrc;
  }

  const poster = document.querySelector("video")?.poster;
  return poster ? String(poster) : "";
}

/** @param {{ idleMs: number }} activityTracker */
function emptySnapshot(url, activityTracker) {
  return {
    hasSignal: false,
    title: "",
    artist: "",
    album: "",
    playbackState: "none",
    artworkUrl: "",
    url,
    duration: 0,
    currentTime: 0,
    pageVisible: document.visibilityState === "visible",
    userIdleMs: activityTracker.idleMs,
    documentState: document.readyState,
  };
}

/**
 * Build a media snapshot for the given page URL.
 * Early-exits without DOM reads when the URL is not on the allowlist.
 * @param {string} url
 * @param {{ idleMs: number }} activityTracker
 */
export function detectMedia(url, activityTracker) {
  if (!isMediaUrl(url)) {
    return emptySnapshot(url, activityTracker);
  }

  const sessionMeta = navigator.mediaSession?.metadata;
  const title       = String(sessionMeta?.title ?? document.title ?? "");
  const artist      = String(sessionMeta?.artist ?? "");
  const album       = String(sessionMeta?.album ?? "");
  const active      = activeMediaElement();
  const mediaMatchRule = matchMediaUrlRule(url) ?? undefined;

  return {
    hasSignal: resolveHasSignal(),
    title,
    artist,
    album,
    playbackState: resolvePlaybackState(),
    artworkUrl: pickArtworkUrl(),
    url,
    duration: active?.duration ?? 0,
    currentTime: active?.currentTime ?? 0,
    pageVisible: document.visibilityState === "visible",
    userIdleMs: activityTracker.idleMs,
    documentState: document.readyState,
    mediaMatchRule,
  };
}

export function hasActiveMedia() {
  const state = resolvePlaybackState();
  return state === "playing" || state === "paused";
}

/** @param {string} url */
export function needsMediaSessionFallback(url) {
  if (!isMediaUrl(url)) return false;
  if (allMediaElements().some((el) => el.readyState >= 1)) return false;
  if (document.hidden && !hasActiveMedia()) return false;

  const ms = navigator.mediaSession;
  if (!ms) return false;
  if (ms.playbackState === "playing" || ms.playbackState === "paused") return true;

  const metaTitle = ms.metadata?.title ?? "";
  return metaTitle.length > 0;
}

export { allMediaElements };
