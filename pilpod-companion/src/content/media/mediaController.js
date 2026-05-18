/**
 * Playback commands: HTMLMediaElement → MediaSession → synthetic keys.
 */

"use strict";

import { activeMediaElement } from "./mediaDetector.js";

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

function _dispatchMediaKey(key) {
  const opts = { key, code: key, bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent("keydown", opts));
  document.dispatchEvent(new KeyboardEvent("keyup",   opts));
}
