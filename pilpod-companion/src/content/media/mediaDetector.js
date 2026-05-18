/**
 * Page media detection — pure functions, no chrome APIs.
 */

"use strict";

function allMediaElements() {
  return [
    ...document.querySelectorAll("video"),
    ...document.querySelectorAll("audio"),
  ];
}

function loadedMediaElements() {
  return allMediaElements().filter((el) => el.readyState >= 1);
}

export function activeMediaElement() {
  const all     = loadedMediaElements();
  const playing = all.find((el) => !el.paused && !el.ended && el.readyState > 2);
  if (playing) return playing;
  return all.find((el) => el.paused && el.readyState > 0) ?? null;
}

export function resolvePlaybackState() {
  const all = loadedMediaElements();
  if (all.some((el) => !el.paused && !el.ended && el.readyState > 2)) return "playing";
  if (all.some((el) => el.paused && el.readyState > 0)) return "paused";

  // MediaSession-only players (e.g. Spotify PWA) before <audio>/<video> is ready.
  const ms = navigator.mediaSession?.playbackState;
  if (ms === "playing") return "playing";
  if (ms === "paused") return "paused";

  return "none";
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

/**
 * @param {{ idleMs: number }} activityTracker
 */
export function buildSnapshot(activityTracker) {
  const sessionMeta = navigator.mediaSession?.metadata;
  const title       = String(sessionMeta?.title ?? document.title ?? "");
  const artist      = String(sessionMeta?.artist ?? "");
  const album       = String(sessionMeta?.album  ?? "");

  const hasLoadedElement     = loadedMediaElements().length > 0;
  const hasMediaSessionTitle = title.length > 0 && (sessionMeta?.title ?? "").length > 0;
  const hasSignal            = hasLoadedElement || hasMediaSessionTitle;

  const active = activeMediaElement();

  return {
    hasSignal,
    title,
    artist,
    album,
    playbackState:  resolvePlaybackState(),
    artworkUrl:     pickArtworkUrl(),
    url:            location.href,
    duration:       active?.duration    ?? 0,
    currentTime:    active?.currentTime ?? 0,
    pageVisible:    document.visibilityState === "visible",
    userIdleMs:     activityTracker.idleMs,
    documentState:  document.readyState,
  };
}
