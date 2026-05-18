/**
 * @file tabPost.js
 * Pure helpers for converting chrome.Tab objects into the TabPost wire format
 * that gets serialised and sent to the Rust desktop app.
 *
 * No side-effects, no chrome API calls — easy to unit-test.
 */

"use strict";

import { TabState } from "../../shared/protocol.js";

/**
 * Map a chrome.Tab's status / flags to a normalised TabState string.
 *
 * @param {chrome.tabs.Tab|null|undefined} tab
 * @returns {string}  one of TabState values
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
 * Build a TabPost from a chrome.Tab.
 * The `media` field is always null here; content.js fills it later via
 * runtime messages received in the background service worker.
 *
 * @param {chrome.tabs.Tab} tab
 * @param {number|null}     focusedWindowId  - current focused window
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