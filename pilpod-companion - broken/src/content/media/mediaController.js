/**
 * @file mediaController.js
 * Executes playback commands on the page using a three-tier strategy:
 *
 *   Priority 1 — HTMLMediaElement API    (most reliable, direct DOM access)
 *   Priority 2 — MediaSession action handler (e.g. Spotify PWA)
 *   Priority 3 — Synthetic keyboard events  (last resort for custom players)
 *
 * Each function is self-contained so new commands can be added without
 * touching existing ones.
 */

"use strict";

import { activeMediaElement } from "./mediaDetector.js";

// ─── Commands ─────────────────────────────────────────────────────────────────

export function doPlayPause() {
  const el = activeMediaElement();
  if (el) {
    if (el.paused) el.play().catch(() => {});
    else           el.pause();
    return;
  }

  const ms = navigator.mediaSession;
  if (ms) {
    const action = ms.playbackState === "playing" ? "pause" : "play";
    try { ms.callActionHandler?.(action, {}); } catch { /* not registered */ }
    return;
  }

  _dispatchMediaKey("MediaPlayPause");
}

export function doNext() {
  try { navigator.mediaSession?.callActionHandler?.("nexttrack", {}); } catch { /* not registered */ }
  _dispatchMediaKey("MediaTrackNext");
}

export function doPrevious() {
  try { navigator.mediaSession?.callActionHandler?.("previoustrack", {}); } catch { /* not registered */ }
  _dispatchMediaKey("MediaTrackPrevious");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Synthesise a media key press as a bubbling keydown + keyup pair. */
function _dispatchMediaKey(key) {
  const opts = { key, code: key, bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent("keydown", opts));
  document.dispatchEvent(new KeyboardEvent("keyup",   opts));
}