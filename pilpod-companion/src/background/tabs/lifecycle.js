/**
 * chrome.tabs / chrome.windows listeners — keep TabRegistry in sync.
 */

"use strict";

import { MSG_MEDIA_SNAPSHOT } from "../../shared/protocol.js";

/**
 * @param {import("./registry.js").TabRegistry} registry
 * @param {() => void} schedulePush
 */
export function registerLifecycleListeners(registry, schedulePush) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (registry.evict(tabId)) schedulePush();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab && tabId != null) {
      // Only clear media when the tab is actually navigating (URL change),
      // not on incidental status-only "loading" events from SPAs.
      const navigating =
        changeInfo.status === "loading" &&
        (changeInfo.url != null || changeInfo.pendingUrl != null);
      registry.upsert(tab, { clearMedia: navigating });
    }
    schedulePush();
  });

  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    registry.replace(addedTabId, removedTabId);
    schedulePush();
  });

  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (registry.activate(tabId, windowId)) schedulePush();
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id != null) {
      registry.upsert(tab);
      schedulePush();
    }
  });

  chrome.windows.onRemoved.addListener(() => {
    chrome.tabs.query({}, (liveTabs) => {
      const liveIds = new Set(liveTabs.map((t) => t.id));
      if (registry.gcAgainst(liveIds)) schedulePush();
    });
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    const newFocus =
      windowId === chrome.windows.WINDOW_ID_NONE ? null : windowId;
    if (registry.setFocusedWindow(newFocus)) schedulePush();
  });

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || msg.type !== MSG_MEDIA_SNAPSHOT) return;

    const tabId = sender?.tab?.id;
    if (tabId == null) return;

    if (!registry.has(tabId) && sender.tab) {
      registry.upsert(sender.tab);
    }

    if (registry.applyMediaSnapshot(tabId, msg.payload ?? {})) {
      schedulePush();
    }
  });
}
