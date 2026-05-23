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

  const SNAPSHOT_DEBOUNCE_MS      = 50;
  const MEDIASESSION_FALLBACK_MS  = 3000;
  const MSG_MEDIA_SNAPSHOT        = "PILPOD_MEDIA_SNAPSHOT";
  const MSG_MEDIA_CONTROL         = "PILPOD_MEDIA_CONTROL";

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

  function hasActiveMedia() {
    const state = _playbackState();
    return state === "playing" || state === "paused";
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

  // ─── Event-driven snapshot reporting ─────────────────────────────────────

  let lastHasSignal = false;
  let debounceTimer = null;
  let fallbackInterval = null;
  let mediaObserver = null;
  const attachedElements = new WeakSet();

  function _sendSnapshot() {
    const snap = _buildSnapshot();
    if (!snap.hasSignal && !lastHasSignal) return;
    lastHasSignal = snap.hasSignal;
    try {
      chrome.runtime.sendMessage({ type: MSG_MEDIA_SNAPSHOT, payload: snap });
    } catch {
      _teardown();
    }
  }

  function scheduleSnapshot() {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      _sendSnapshot();
      _syncFallbackPoll();
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  function attachMediaElement(el) {
    if (!(el instanceof HTMLMediaElement) || attachedElements.has(el)) return;
    attachedElements.add(el);
    for (const evt of ["play", "pause", "ended", "loadeddata", "loadedmetadata", "volumechange", "timeupdate"]) {
      el.addEventListener(evt, scheduleSnapshot, { passive: true });
    }
  }

  function scanExistingMedia() {
    for (const el of _allMedia()) attachMediaElement(el);
  }

  function _needsMediaSessionFallback() {
    if (_loadedMedia().length > 0) return false;
    if (document.hidden && !hasActiveMedia()) return false;
    const ms = navigator.mediaSession;
    if (!ms) return false;
    if (ms.playbackState === "playing" || ms.playbackState === "paused") return true;
    const metaTitle = ms.metadata?.title ?? "";
    return metaTitle.length > 0;
  }

  function startFallbackPoll() {
    if (fallbackInterval !== null) return;
    fallbackInterval = setInterval(_sendSnapshot, MEDIASESSION_FALLBACK_MS);
  }

  function stopFallbackPoll() {
    if (fallbackInterval === null) return;
    clearInterval(fallbackInterval);
    fallbackInterval = null;
  }

  function _syncFallbackPoll() {
    if (_needsMediaSessionFallback()) startFallbackPoll();
    else stopFallbackPoll();
  }

  function _startObserver() {
    if (mediaObserver !== null) return;
    mediaObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLMediaElement) {
            attachMediaElement(node);
            scheduleSnapshot();
          } else if (node instanceof Element) {
            for (const el of node.querySelectorAll("video, audio")) {
              attachMediaElement(el);
            }
          }
        }
      }
    });
    mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function _teardown() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    stopFallbackPoll();
    if (mediaObserver !== null) {
      mediaObserver.disconnect();
      mediaObserver = null;
    }
  }

  function _syncActivityState() {
    scanExistingMedia();
    if (document.hidden && !hasActiveMedia()) {
      stopFallbackPoll();
    } else {
      _syncFallbackPoll();
    }
    scheduleSnapshot();
  }

  document.addEventListener("visibilitychange", _syncActivityState);

  _startObserver();
  scanExistingMedia();
  _syncActivityState();
}
