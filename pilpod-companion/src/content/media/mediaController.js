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

/**
 * Seek the active media element to the given time in seconds.
 * @param {number} seconds
 */
export function doSeek(seconds) {
  const el = activeMediaElement();
  if (!el || !isFinite(seconds)) return;
  el.currentTime = Math.max(0, Math.min(el.duration || 0, seconds));
}

// ── Web Audio gain for volumes above 100% ────────────────────────────────────
let _gainCtx  = null;
let _gainNode = null;
let _gainEl   = null;

function _ensureGain(el) {
  if (_gainEl === el && _gainNode) return _gainNode;
  try {
    if (!_gainCtx) _gainCtx = new AudioContext();
    const src = _gainCtx.createMediaElementSource(el);
    _gainNode = _gainCtx.createGain();
    src.connect(_gainNode);
    _gainNode.connect(_gainCtx.destination);
    _gainEl = el;
  } catch {
    _gainNode = null;
  }
  return _gainNode;
}

/**
 * Set tab volume. Range 0–600 (100 = 100%).
 * 0–100 uses native HTMLMediaElement.volume; 100–600 adds Web Audio API gain.
 * @param {number} pct
 */
export function doSetTabVolume(pct) {
  const el = activeMediaElement();
  if (!el) return;
  const fraction = Math.max(0, pct) / 100;
  if (fraction <= 1) {
    el.volume = fraction;
    if (_gainNode) _gainNode.gain.value = 1;
  } else {
    el.volume = 1;
    const gn = _ensureGain(el);
    if (gn) gn.gain.value = fraction;
  }
}

/**
 * Get current effective tab volume as 0–600 percentage.
 * @returns {number}
 */
export function getTabVolume() {
  const el = activeMediaElement();
  if (!el) return 100;
  const native = el.volume;
  const gain   = (_gainNode && _gainEl === el) ? _gainNode.gain.value : 1;
  return Math.round(native * gain * 100);
}

/**
 * Mute / unmute the active media element.
 * @param {boolean} [force] - If provided, set muted to this value; otherwise toggle.
 */
export function doMuteTab(force) {
  const el = activeMediaElement();
  if (!el) return;
  el.muted = (force !== undefined) ? Boolean(force) : !el.muted;
}

/**
 * Attempt to skip the current ad. Works on YouTube-style skip buttons.
 */
export function doSkipAd() {
  // YouTube skip button
  const btn =
    document.querySelector(".ytp-skip-ad-button") ||
    document.querySelector(".ytp-ad-skip-button") ||
    document.querySelector('[class*="skip-ad"]') ||
    document.querySelector('[class*="skipAd"]') ||
    document.querySelector('[aria-label*="Skip"]');
  if (btn instanceof HTMLElement) {
    btn.click();
    return;
  }
  // Generic: seek to end of ad duration if possible
  const el = activeMediaElement();
  if (el && isFinite(el.duration)) {
    el.currentTime = el.duration;
  }
}

/**
 * Toggle Picture-in-Picture for the first video element.
 */
export async function doPip() {
  const video = document.querySelector("video");
  if (!video) return;
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  } catch { /* not supported or not allowed */ }
}

function _dispatchMediaKey(key) {
  const opts = { key, code: key, bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent("keydown", opts));
  document.dispatchEvent(new KeyboardEvent("keyup",   opts));
}
