/**
 * TabRegistry — single source of truth for all open tabs and their media state.
 */

"use strict";

import { buildTabPost } from "./tabPost.js";
import { TabState }     from "../../shared/protocol.js";

export class TabRegistry {
  /** @type {Map<number, import("../../shared/protocol.js").TabPost>} */
  #tabs = new Map();

  /** @type {number|null} */
  #focusedWindowId = null;

  /** @param {number|null} windowId */
  setFocusedWindow(windowId) {
    this.#focusedWindowId = windowId;
    let changed = false;
    for (const meta of this.#tabs.values()) {
      const next = meta.windowId === windowId;
      if (meta.windowFocused !== next) {
        meta.windowFocused = next;
        changed = true;
      }
    }
    return changed;
  }

  /** @returns {import("../../shared/protocol.js").TabPost[]} */
  all() {
    return Array.from(this.#tabs.values());
  }

  /** @param {number} tabId */
  get(tabId) {
    return this.#tabs.get(tabId) ?? null;
  }

  /** @param {number} tabId */
  has(tabId) {
    return this.#tabs.has(tabId);
  }

  /**
   * @param {chrome.tabs.Tab} tab
   * @param {{ clearMedia?: boolean }} [opts]
   * @returns {boolean}
   */
  upsert(tab, { clearMedia = false } = {}) {
    if (tab.id == null) return false;
    const existing = this.#tabs.get(tab.id);
    const updated  = buildTabPost(tab, this.#focusedWindowId);
    updated.media  = clearMedia ? null : (existing?.media ?? null);
    this.#tabs.set(tab.id, updated);
    return true;
  }

  /** @param {chrome.tabs.Tab[]} tabs */
  seed(tabs) {
    for (const tab of tabs) {
      this.upsert(tab);
    }
  }

  /** @param {number} tabId */
  evict(tabId) {
    if (!this.#tabs.has(tabId)) return false;
    this.#tabs.delete(tabId);
    return true;
  }

  replace(addedTabId, removedTabId) {
    const old = this.#tabs.get(removedTabId);
    this.#tabs.delete(removedTabId);
    if (old) {
      this.#tabs.set(addedTabId, { ...old, tabId: addedTabId });
    }
    return true;
  }

  /** @param {Set<number>} liveIds */
  gcAgainst(liveIds) {
    let changed = false;
    for (const tabId of this.#tabs.keys()) {
      if (!liveIds.has(tabId)) {
        this.#tabs.delete(tabId);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * @param {number} tabId
   * @param {object} p
   * @returns {boolean}
   */
  applyMediaSnapshot(tabId, p) {
    const meta = this.#tabs.get(tabId);
    if (!meta) return false;

    if (p.hasSignal !== true) {
      if (meta.media === null) return false;
      meta.media = null;
      return true;
    }

    const next = {
      playbackState: String(p.playbackState ?? "none"),
      title:         String(p.title         ?? ""),
      artist:        String(p.artist        ?? ""),
      album:         String(p.album         ?? ""),
      artworkUrl:    String(p.artworkUrl    ?? ""),
      duration:      Number(p.duration      ?? 0),
      currentTime:   Number(p.currentTime   ?? 0),
      pageVisible:   Boolean(p.pageVisible),
      userIdleMs:    Number(p.userIdleMs    ?? 0),
      documentState: String(p.documentState ?? ""),
    };

    const changed = JSON.stringify(meta.media) !== JSON.stringify(next);
    if (changed) meta.media = next;
    return changed;
  }

  clearMedia(tabId) {
    const meta = this.#tabs.get(tabId);
    if (!meta || meta.media === null) return false;
    meta.media = null;
    return true;
  }

  activate(tabId, windowId) {
    let changed = false;
    for (const [id, meta] of this.#tabs) {
      if (meta.windowId !== windowId) continue;
      const wasActive = meta.active;
      meta.active = id === tabId;
      if (meta.active) {
        meta.tabState = TabState.ACTIVE;
      } else if (meta.tabState === TabState.ACTIVE) {
        meta.tabState = TabState.INACTIVE;
      }
      if (wasActive !== meta.active) changed = true;
    }
    return changed;
  }

  setTabState(tabId, tabState) {
    const meta = this.#tabs.get(tabId);
    if (!meta) return false;
    meta.tabState = tabState;
    return true;
  }
}
