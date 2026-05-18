/**
 * @file registry.js
 * TabRegistry — the single source of truth for all open tabs.
 *
 * Owns the allTabsMeta Map and exposes a clean API so that the rest of
 * background.js never touches the Map directly.  This boundary makes it
 * trivial to swap the backing store (e.g. IndexedDB for persistence) later.
 *
 * All mutation methods return `true` when the map changed so callers can
 * decide whether to schedule a push.
 */

"use strict";

import { buildTabPost } from "./tabPost.js";
import { TabState }     from "../../shared/protocol.js";

export class TabRegistry {
  /** @type {Map<number, import("../../shared/protocol.js").TabPost>} */
  #tabs = new Map();

  /** Current focused window id — injected by background state. */
  #focusedWindowId = null;

  // ── Focused window ────────────────────────────────────────────────────────

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

  // ── Read ──────────────────────────────────────────────────────────────────

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

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Upsert a tab from a chrome.Tab object.
   * Existing `media` is preserved unless `clearMedia` is true.
   *
   * @param {chrome.tabs.Tab} tab
   * @param {{ clearMedia?: boolean }} [opts]
   * @returns {boolean} changed
   */
  upsert(tab, { clearMedia = false } = {}) {
    if (tab.id == null) return false;
    const existing = this.#tabs.get(tab.id);
    const updated  = buildTabPost(tab, this.#focusedWindowId);
    updated.media  = clearMedia ? null : (existing?.media ?? null);
    this.#tabs.set(tab.id, updated);
    return true;
  }

  /**
   * Seed the registry from the full list of open tabs at startup.
   * @param {chrome.tabs.Tab[]} tabs
   */
  seed(tabs) {
    for (const tab of tabs) {
      this.upsert(tab);
    }
  }

  /**
   * Remove a tab.
   * @param {number} tabId
   * @returns {boolean} changed
   */
  evict(tabId) {
    if (!this.#tabs.has(tabId)) return false;
    this.#tabs.delete(tabId);
    return true;
  }

  /**
   * Replace a tab id (chrome.tabs.onReplaced).
   * @param {number} addedTabId
   * @param {number} removedTabId
   * @returns {boolean}
   */
  replace(addedTabId, removedTabId) {
    const old = this.#tabs.get(removedTabId);
    this.#tabs.delete(removedTabId);
    if (old) {
      this.#tabs.set(addedTabId, { ...old, tabId: addedTabId });
    }
    return true;
  }

  /**
   * Remove any tab whose id is not in `liveIds`.
   * @param {Set<number>} liveIds
   * @returns {boolean} changed
   */
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

  // ── Media ─────────────────────────────────────────────────────────────────

  /**
   * Apply a media snapshot payload from the content script.
   * Returns true when the stored media state actually changed.
   *
   * @param {number} tabId
   * @param {object} p  - raw payload from PILPOD_MEDIA_SNAPSHOT message
   * @returns {boolean} changed
   */
  applyMediaSnapshot(tabId, p) {
    const meta = this.#tabs.get(tabId);
    if (!meta) return false;

    if (!p.hasSignal) {
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

  /** Clear media on a tab (e.g. navigation start or content script exit). */
  clearMedia(tabId) {
    const meta = this.#tabs.get(tabId);
    if (!meta || meta.media === null) return false;
    meta.media = null;
    return true;
  }

  // ── Activation ────────────────────────────────────────────────────────────

  /**
   * Update active/tabState for all tabs in a window when a new tab is
   * activated (chrome.tabs.onActivated).
   *
   * @param {number} tabId
   * @param {number} windowId
   * @returns {boolean} changed
   */
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

  /**
   * Optimistically mark a tab as loading (before the chrome API confirms).
   * @param {number} tabId
   * @param {string} tabState
   */
  setTabState(tabId, tabState) {
    const meta = this.#tabs.get(tabId);
    if (!meta) return false;
    meta.tabState = tabState;
    return true;
  }
}