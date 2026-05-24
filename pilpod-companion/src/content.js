/**
 * PilPod Content Script — thin bootstrap for detection and playback control.
 */

"use strict";

import { ActivityTracker } from "./content/activity/activityTracker.js";
import {
  allMediaElements,
  detectMedia,
  hasActiveMedia,
  needsMediaSessionFallback,
} from "./content/media/mediaDetector.js";
import { doNext, doPlayPause, doPrevious } from "./content/media/mediaController.js";

if (!globalThis.__pilpodCompanionContent) {
  globalThis.__pilpodCompanionContent = true;

  const SNAPSHOT_DEBOUNCE_MS     = 50;
  const MEDIASESSION_FALLBACK_MS = 3000;
  const MSG_MEDIA_SNAPSHOT       = "PILPOD_MEDIA_SNAPSHOT";
  const MSG_MEDIA_CONTROL        = "PILPOD_MEDIA_CONTROL";

  const activityTracker = new ActivityTracker();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== MSG_MEDIA_CONTROL) return false;
    switch (String(msg.action ?? "")) {
      case "playPause": doPlayPause(); break;
      case "next":      doNext();      break;
      case "previous":  doPrevious();  break;
      default: break;
    }
    sendResponse({ ok: true });
    return true;
  });

  let lastHasSignal = false;
  let debounceTimer = null;
  let fallbackInterval = null;
  let mediaObserver = null;
  const attachedElements = new WeakSet();

  function sendSnapshot() {
    const snap = detectMedia(location.href, activityTracker);
    if (!snap.hasSignal && !lastHasSignal) return;
    lastHasSignal = snap.hasSignal;
    try {
      chrome.runtime.sendMessage({ type: MSG_MEDIA_SNAPSHOT, payload: snap });
    } catch {
      teardown();
    }
  }

  function scheduleSnapshot() {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      sendSnapshot();
      syncFallbackPoll();
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
    for (const el of allMediaElements()) attachMediaElement(el);
  }

  function startFallbackPoll() {
    if (fallbackInterval !== null) return;
    fallbackInterval = setInterval(sendSnapshot, MEDIASESSION_FALLBACK_MS);
  }

  function stopFallbackPoll() {
    if (fallbackInterval === null) return;
    clearInterval(fallbackInterval);
    fallbackInterval = null;
  }

  function syncFallbackPoll() {
    if (needsMediaSessionFallback(location.href)) startFallbackPoll();
    else stopFallbackPoll();
  }

  function startObserver() {
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

  function teardown() {
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

  function syncActivityState() {
    scanExistingMedia();
    if (document.hidden && !hasActiveMedia()) {
      stopFallbackPoll();
    } else {
      syncFallbackPoll();
    }
    scheduleSnapshot();
  }

  document.addEventListener("visibilitychange", syncActivityState);

  startObserver();
  scanExistingMedia();
  syncActivityState();
}
