/**
 * PilPod Content Script (single-file — no ES module imports).
 *
 * Content scripts run in the page's context where ES module import resolution
 * is unreliable across origins and CSP rules.  All dependencies are inlined.
 *
 * Responsibilities:
 *   1. Detect media elements / MediaSession on the page.
 *   2. Report snapshots to the service worker via chrome.runtime.sendMessage.
 *   3. Execute playback commands sent back from the service worker.
 *   4. Report page-activity hints (visibility, idle time, readyState).
 */

"use strict";

// ─── Prevent duplicate loops on re-injection ──────────────────────────────────

if (globalThis.__pilpodCompanionContent) {
  // Already running in this tab — do nothing.
} else {
  globalThis.__pilpodCompanionContent = true;

  // ─── Constants ────────────────────────────────────────────────────────────

  const TICK_MS              = 800;
  const MSG_MEDIA_SNAPSHOT   = "PILPOD_MEDIA_SNAPSHOT";
  const MSG_MEDIA_CONTROL    = "PILPOD_MEDIA_CONTROL";

  // ─── Activity tracking ────────────────────────────────────────────────────

  let lastActivityAt = Date.now();
  const _resetActivity = () => { lastActivityAt = Date.now(); };
  ["mousemove", "keydown", "scroll", "click", "touchstart", "pointerdown"]
    .forEach((e) => document.addEventListener(e, _resetActivity, { passive: true, capture: true }));

  // ─── Media helpers ────────────────────────────────────────────────────────

  function _allMedia() {
    return [
      ...document.querySelectorAll("video"),
      ...document.querySelectorAll("audio"),
    ];
  }

  function _loadedMedia() {
    return _allMedia().filter((el) => el.readyState >= 1);
  }

  function _activeMedia() {
    const all     = _loadedMedia();
    const playing = all.find((el) => !el.paused && !el.ended && el.readyState > 2);
    if (playing) return playing;
    return all.find((el) => el.paused && el.readyState > 0) ?? null;
  }

  function _playbackState() {
    const all = _loadedMedia();
    if (all.some((el) => !el.paused && !el.ended && el.readyState > 2)) return "playing";
    if (all.some((el) => el.paused && el.readyState > 0)) return "paused";
    // MediaSession-only players (Spotify PWA, etc.) before <audio>/<video> is ready.
    const ms = navigator.mediaSession?.playbackState;
    if (ms === "playing") return "playing";
    if (ms === "paused")  return "paused";
    return "none";
  }

  function _artworkUrl() {
    const artwork = navigator.mediaSession?.metadata?.artwork ?? [];
    if (artwork.length > 0) {
      let bestSrc = "", bestW = 0;
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

  function _buildSnapshot() {
    const sessionMeta = navigator.mediaSession?.metadata;
    const title       = String(sessionMeta?.title  ?? document.title ?? "");
    const artist      = String(sessionMeta?.artist ?? "");
    const album       = String(sessionMeta?.album  ?? "");

    const hasLoadedElement     = _loadedMedia().length > 0;
    const hasMediaSessionTitle = title.length > 0 && (sessionMeta?.title ?? "").length > 0;
    const hasSignal            = hasLoadedElement || hasMediaSessionTitle;

    const active = _activeMedia();

    return {
      hasSignal,
      title,
      artist,
      album,
      playbackState:  _playbackState(),
      artworkUrl:     _artworkUrl(),
      url:            location.href,
      duration:       active?.duration    ?? 0,
      currentTime:    active?.currentTime ?? 0,
      pageVisible:    document.visibilityState === "visible",
      userIdleMs:     Date.now() - lastActivityAt,
      documentState:  document.readyState,
    };
  }

  // ─── Playback commands ────────────────────────────────────────────────────

  function _doPlayPause() {
    const el = _activeMedia();
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
    _key("MediaPlayPause");
  }

  function _doNext() {
    try { navigator.mediaSession?.callActionHandler?.("nexttrack", {}); } catch { /* not registered */ }
    _key("MediaTrackNext");
  }

  function _doPrevious() {
    try { navigator.mediaSession?.callActionHandler?.("previoustrack", {}); } catch { /* not registered */ }
    _key("MediaTrackPrevious");
  }

  function _key(k) {
    const opts = { key: k, code: k, bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent("keydown", opts));
    document.dispatchEvent(new KeyboardEvent("keyup",   opts));
  }

  // ─── Message listener ─────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== MSG_MEDIA_CONTROL) return false;
    switch (String(msg.action ?? "")) {
      case "playPause": _doPlayPause(); break;
      case "next":      _doNext();      break;
      case "previous":  _doPrevious();  break;
      default: break;
    }
    sendResponse({ ok: true });
    return true;
  });

  // ─── Snapshot loop ────────────────────────────────────────────────────────

  let lastHasSignal = false;

  function _tick() {
    const snap = _buildSnapshot();
    if (!snap.hasSignal && !lastHasSignal) return;
    lastHasSignal = snap.hasSignal;
    try {
      chrome.runtime.sendMessage({ type: MSG_MEDIA_SNAPSHOT, payload: snap });
    } catch {
      clearInterval(_interval);
    }
  }

  const _interval = setInterval(_tick, TICK_MS);
  _tick();
}
