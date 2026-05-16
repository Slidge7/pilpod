/**
 * PilPod Content Script
 * ---------------------
 * Runs in every page (document_idle, top frame only).
 *
 * Responsibilities:
 *  1. Detect whether this tab actually has a meaningful media element.
 *  2. Report a snapshot to background.js every TICK_MS.
 *  3. Execute play/pause and track-skip commands sent from background.js.
 *
 * Play/Pause strategy (universal, not YouTube-only):
 *  Priority 1 — HTMLMediaElement.play() / .pause()  (works everywhere)
 *  Priority 2 — MediaSession action handler         (Spotify, SoundCloud, etc.)
 *  Priority 3 — Keyboard MediaTrackNext / MediaTrackPrevious synthetic events
 *
 * A tab is considered "has media" only when at least one <video> or <audio>
 * element exists AND has loaded enough data to know its duration (readyState ≥ 1)
 * OR the MediaSession metadata has a non-empty title.  Pure placeholder / ad-slot
 * elements that never loaded are silently ignored.
 */

"use strict";

const TICK_MS = 800;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function allMediaElements() {
  return [
    ...document.querySelectorAll("video"),
    ...document.querySelectorAll("audio"),
  ];
}

/**
 * Returns only elements that have actually loaded media data.
 * readyState >= 1 means the browser has at least the metadata (duration, etc.)
 */
function loadedMediaElements() {
  return allMediaElements().filter((el) => el.readyState >= 1);
}

/** Pick the active (playing or paused-with-content) media element, if any. */
function activeMediaElement() {
  const all = loadedMediaElements();
  // Prefer the one that is currently playing
  const playing = all.find((el) => !el.paused && !el.ended && el.readyState > 2);
  if (playing) return playing;
  // Fall back to any paused element with loaded content
  return all.find((el) => el.paused && el.readyState > 0) || null;
}

/** Determine playback state from actual DOM state. */
function playbackState() {
  const all = loadedMediaElements();
  if (all.length === 0) return "none";
  const playing = all.some((el) => !el.paused && !el.ended && el.readyState > 2);
  if (playing) return "playing";
  const hasContent = all.some((el) => el.readyState > 0 && el.paused);
  if (hasContent) return "paused";
  return "none";
}

/** Pick the best artwork URL from MediaSession or video.poster. */
function pickArtworkUrl() {
  const meta = navigator.mediaSession?.metadata;
  if (meta?.artwork?.length) {
    let bestSrc = "";
    let bestW = 0;
    for (const a of meta.artwork) {
      if (!a?.src) continue;
      const src = String(a.src);
      const w = parseInt(String(a.sizes || "").split(/[x×]/)[0], 10) || 0;
      if (w > bestW || !bestSrc) {
        bestW = w;
        bestSrc = src;
      }
    }
    if (bestSrc) return bestSrc;
  }
  const v = document.querySelector("video");
  if (v?.poster) return String(v.poster);
  return "";
}

/** Build a snapshot of current media state for this tab. */
function snapshot() {
  const meta = navigator.mediaSession?.metadata;

  const title  = String(meta?.title  || document.title || "");
  const artist = String(meta?.artist || "");
  const album  = String(meta?.album  || "");
  const state  = playbackState();

  /**
   * "Has signal" = the tab genuinely contains addressable media.
   * We require at least one loaded media element OR a MediaSession title.
   * This prevents ghost entries from pages that have an empty <video> tag
   * just for background animation / analytics pixel purposes.
   */
  const hasLoadedElement = loadedMediaElements().length > 0;
  const hasMediaSessionTitle = title.length > 0 && (meta?.title || "").length > 0;
  const hasSignal = hasLoadedElement || hasMediaSessionTitle;

  return {
    hasSignal,
    title,
    artist,
    album,
    playbackState: state,
    artworkUrl: pickArtworkUrl(),
    url: location.href,
    duration: activeMediaElement()?.duration || 0,
    currentTime: activeMediaElement()?.currentTime || 0,
  };
}

// ─── Play / Pause / Skip ──────────────────────────────────────────────────────

/**
 * Universal play/pause.
 * 1. Try direct HTMLMediaElement API (works on every site).
 * 2. Try MediaSession action handler as a fallback.
 */
function doPlayPause() {
  const el = activeMediaElement();
  if (el) {
    if (el.paused) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
    return;
  }
  // Fallback: trigger MediaSession play/pause action
  const ms = navigator.mediaSession;
  if (ms) {
    const action = ms.playbackState === "playing" ? "pause" : "play";
    try {
      // Some sites (Spotify web) register these handlers
      ms.callActionHandler?.(action, {});
    } catch (_) {}
  }
  // Last resort: synthetic keyboard event (rarely needed now)
  _dispatchKey("MediaPlayPause");
}

function doNext() {
  const ms = navigator.mediaSession;
  try { ms?.callActionHandler?.("nexttrack", {}); } catch (_) {}
  _dispatchKey("MediaTrackNext");
}

function doPrevious() {
  const ms = navigator.mediaSession;
  try { ms?.callActionHandler?.("previoustrack", {}); } catch (_) {}
  _dispatchKey("MediaTrackPrevious");
}

function _dispatchKey(key) {
  const opts = { key, code: key, bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent("keydown", opts));
  document.dispatchEvent(new KeyboardEvent("keyup", opts));
}

// ─── Message Listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "PILPOD_MEDIA_CONTROL") return false;

  switch (String(msg.action || "")) {
    case "playPause":  doPlayPause();  break;
    case "next":       doNext();       break;
    case "previous":   doPrevious();   break;
    default: break;
  }

  sendResponse({ ok: true });
  return true; // keep channel open (important for async safety)
});

// ─── Snapshot Loop ───────────────────────────────────────────────────────────

let lastHasSignal = false;

function tick() {
  const snap = snapshot();

  // Only send if we have media OR if we previously had media and need to clear it.
  // This avoids spamming background with empty-signal messages on every page.
  if (!snap.hasSignal && !lastHasSignal) return;

  lastHasSignal = snap.hasSignal;

  try {
    chrome.runtime.sendMessage({
      type: "PILPOD_MEDIA_SNAPSHOT",
      payload: snap,
    });
  } catch (_) {
    // Extension context invalidated (e.g. after update) — stop ticking
    clearInterval(tickInterval);
  }
}

const tickInterval = setInterval(tick, TICK_MS);
tick(); // immediate first tick
