/**
 * @file content.js  (content script entry point)
 * Runs in every page (document_idle, top frame only).
 *
 * Responsibilities:
 *   1. Sample media state on a fixed tick and push snapshots to background.js.
 *   2. Execute playback commands forwarded from background.js.
 */

"use strict";

import { CONTENT_TICK_MS } from "./shared/constants.js";
import { MSG_MEDIA_SNAPSHOT, MSG_MEDIA_CONTROL, Command } from "./shared/protocol.js";
import { ActivityTracker } from "./content/activity/activityTracker.js";
import { buildSnapshot } from "./content/media/mediaDetector.js";
import { doPlayPause, doNext, doPrevious } from "./content/media/mediaController.js";

const activityTracker = new ActivityTracker();

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== MSG_MEDIA_CONTROL) return false;

  switch (String(msg.action ?? "")) {
    case Command.PLAY_PAUSE: doPlayPause(); break;
    case Command.NEXT:       doNext();       break;
    case Command.PREVIOUS:   doPrevious();   break;
    default: break;
  }

  sendResponse({ ok: true });
  return true;
});

// ─── Snapshot loop ────────────────────────────────────────────────────────────

let lastHasSignal = false;

function tick() {
  const snap = buildSnapshot(activityTracker);

  if (!snap.hasSignal && !lastHasSignal) return;

  lastHasSignal = snap.hasSignal;

  try {
    chrome.runtime.sendMessage({
      type: MSG_MEDIA_SNAPSHOT,
      payload: snap,
    });
  } catch {
    clearInterval(tickInterval);
  }
}

const tickInterval = setInterval(tick, CONTENT_TICK_MS);
tick();
