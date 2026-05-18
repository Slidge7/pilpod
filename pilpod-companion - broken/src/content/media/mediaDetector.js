/**
 * @file mediaDetector.js
 * Interrogates the page's HTMLMediaElements and MediaSession API to produce
 * a self-contained snapshot of current playback state.
 *
 * Pure functions only — no side-effects, no chrome API, easy to unit-test.
 */

"use strict";

// ─── Element Queries ──────────────────────────────────────────────────────────

/** @returns {HTMLMediaElement[]} all video + audio elements on the page */
function allMediaElements() {
  return [
    ...document.querySelectorAll("video"),
    ...document.querySelectorAll("audio"),
  ];
}

/**
 * Elements that have been loaded enough to have metadata (duration, etc.).
 * readyState >= HAVE_METADATA (1)
 * @returns {HTMLMediaElement[]}
 */
function loadedMediaElements() {
  return allMediaElements().filter((el) => el.readyState >= 1);
}

/**
 * The "most relevant" media element on the page:
 *   Priority 1 — actively playing (not paused, not ended, readyState > HAVE_FUTURE_DATA)
 *   Priority 2 — paused but loaded (readyState > HAVE_NOTHING)
 *   Priority 3 — null
 *
 * @returns {HTMLMediaElement|null}
 */
export function activeMediaElement() {
  const all     = loadedMediaElements();
  const playing = all.find((el) => !el.paused && !el.ended && el.readyState > 2);
  if (playing) return playing;
  return all.find((el) => el.paused && el.readyState > 0) ?? null;
}

// ─── Playback State ───────────────────────────────────────────────────────────

/**
 * @returns {"playing"|"paused"|"none"}
 */
export function resolvePlaybackState() {
  const all = loadedMediaElements();
  if (all.length === 0) return "none";
  if (all.some((el) => !el.paused && !el.ended && el.readyState > 2)) return "playing";
  if (all.some((el) => el.paused && el.readyState > 0)) return "paused";
  return "none";
}

// ─── Artwork ──────────────────────────────────────────────────────────────────

/**
 * Pick the best artwork URL from MediaSession metadata or the video poster.
 * Prefers the largest artwork image by declared width.
 *
 * @returns {string}
 */
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

// ─── Snapshot ─────────────────────────────────────────────────────────────────

/**
 * Build a complete snapshot of the page's current media state.
 * `activityTracker` is injected rather than imported to keep this module pure.
 *
 * @param {{ idleMs: number }} activityTracker
 * @returns {import("../../shared/protocol.js").MediaSnapshot & { hasSignal: boolean, url: string }}
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
    // Tab activity signals
    pageVisible:    document.visibilityState === "visible",
    userIdleMs:     activityTracker.idleMs,
    documentState:  document.readyState,
  };
}