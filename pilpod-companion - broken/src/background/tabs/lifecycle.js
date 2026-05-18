/**
 * @file lifecycle.js
 * Registers all chrome.tabs.* and chrome.windows.* event listeners that keep
 * the TabRegistry in sync with the real browser state.
 *
 * Each listener is a thin adapter: validate → mutate registry → maybe push.
 * No business logic lives here.
 */

"use strict";

import { MSG_MEDIA_SNAPSHOT } from "../../shared/protocol.js";

/**
 * Wire up all tab and window lifecycle listeners.
 *
 * @param {import("../tabs/registry.js").TabRegistry} registry
 * @param {() => void} schedulePush
 */
export function registerLifecycleListeners(registry, schedulePush) {
  // ── Tab removed ────────────────────────────────────────────────────────────

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (registry.evict(tabId)) schedulePush();
  });

  // ── Tab updated (navigation, title change, status change) ──────────────────

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab && tabId != null) {
      // Clear media on navigation start; preserve on other updates.
      const clearMedia = changeInfo.status === "loading";
      registry.upsert(tab, { clearMedia });
    }
    schedulePush();
  });

  // ── Tab replaced (e.g. prerender swap) ─────────────────────────────────────

  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    registry.replace(addedTabId, removedTabId);
    schedulePush();
  });

  // ── Tab activated (focus moved within a window) ────────────────────────────

  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (registry.activate(tabId, windowId)) schedulePush();
  });

  // ── Tab created ────────────────────────────────────────────────────────────

  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id != null) {
      registry.upsert(tab);
      schedulePush();
    }
  });

  // ── Window removed — GC any tabs that disappeared with it ─────────────────

  chrome.windows.onRemoved.addListener(() => {
    chrome.tabs.query({}, (liveTabs) => {
      const liveIds = new Set(liveTabs.map((t) => t.id));
      if (registry.gcAgainst(liveIds)) schedulePush();
    });
  });

  // ── Window focus changed ───────────────────────────────────────────────────

  chrome.windows.onFocusChanged.addListener((windowId) => {
    const newFocus =
      windowId === chrome.windows.WINDOW_ID_NONE ? null : windowId;
    if (registry.setFocusedWindow(newFocus)) schedulePush();
  });

  // ── Content script: media snapshot ────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || msg.type !== MSG_MEDIA_SNAPSHOT) return;

    const tabId = sender?.tab?.id;
    if (tabId == null) return;

    // Register tabs that come in before the initial chrome.tabs.query resolves.
    if (!registry.has(tabId) && sender.tab) {
      registry.upsert(sender.tab);
    }

    if (registry.applyMediaSnapshot(tabId, msg.payload ?? {})) {
      schedulePush();
    }
  });
}