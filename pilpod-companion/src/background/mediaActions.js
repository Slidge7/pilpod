/**
 * Background-level media actions that operate across all tabs in the registry.
 */

"use strict";

import { MSG_MEDIA_CONTROL } from "../shared/protocol.js";

/**
 * Pause all tabs that are currently playing.
 * @param {import("./tabs/registry.js").TabRegistry} registry
 */
export async function pauseAllTabs(registry) {
  for (const [tabId, meta] of registry.entries()) {
    if (meta?.media?.playbackState === "playing") {
      await chrome.tabs
        .sendMessage(tabId, { type: MSG_MEDIA_CONTROL, action: "playPause" })
        .catch(() => {});
    }
  }
}

/**
 * Mute all tabs that have active media.
 * @param {import("./tabs/registry.js").TabRegistry} registry
 */
export async function muteAllTabs(registry) {
  for (const [tabId, meta] of registry.entries()) {
    if (meta?.media) {
      await chrome.tabs
        .sendMessage(tabId, { type: MSG_MEDIA_CONTROL, action: "muteTab", value: true })
        .catch(() => {});
    }
  }
}

/**
 * Reset tab volume to 100% for all tabs with active media.
 * @param {import("./tabs/registry.js").TabRegistry} registry
 */
export async function resetAllVolumes(registry) {
  for (const [tabId, meta] of registry.entries()) {
    if (meta?.media) {
      await chrome.tabs
        .sendMessage(tabId, { type: MSG_MEDIA_CONTROL, action: "setTabVolume", value: 100 })
        .catch(() => {});
    }
  }
}
