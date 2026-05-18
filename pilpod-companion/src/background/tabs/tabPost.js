/**
 * Pure helpers: chrome.Tab → TabPost wire object.
 */

"use strict";

import { TabState } from "../../shared/protocol.js";

/**
 * @param {chrome.tabs.Tab|null|undefined} tab
 * @returns {string}
 */
export function resolveTabState(tab) {
  if (!tab) return TabState.UNKNOWN;
  if (tab.discarded || tab.status === "unloaded") return TabState.SLEEPING;
  if (tab.status === "crashed")  return TabState.CRASHED;
  if (tab.status === "loading")  return TabState.LOADING;
  if (tab.status === "complete") return tab.active ? TabState.ACTIVE : TabState.INACTIVE;
  return TabState.UNKNOWN;
}

/**
 * @param {chrome.tabs.Tab} tab
 * @param {number|null} focusedWindowId
 * @returns {import("../../shared/protocol.js").TabPost}
 */
export function buildTabPost(tab, focusedWindowId) {
  return {
    tabId:         tab.id,
    windowId:      tab.windowId,
    url:           tab.url        ?? tab.pendingUrl ?? "",
    title:         tab.title      ?? "",
    favIconUrl:    tab.favIconUrl ?? "",
    tabState:      resolveTabState(tab),
    active:        tab.active     ?? false,
    windowFocused: tab.windowId   === focusedWindowId,
    audible:       tab.audible    ?? false,
    muted:         tab.mutedInfo?.muted ?? false,
    pinned:        tab.pinned     ?? false,
    index:         tab.index,
    media:         null,
  };
}
