/**
 * @file commandHandler.js
 * Routes commands received from the Rust desktop app to the appropriate
 * browser action (tab management) or content-script message (media control).
 *
 * Design rules:
 *   - Tab-management commands work on any tab regardless of media state.
 *   - Media commands are silently dropped when the tab has no active media
 *     session (guard against stale state in the Rust side).
 *   - Failed content-script messages clear the tab's media state and trigger
 *     a push so Rust stays consistent.
 */

"use strict";

import { Command, MSG_MEDIA_CONTROL } from "../../shared/protocol.js";
import { TabState }                   from "../../shared/protocol.js";

export class CommandHandler {
  /**
   * @param {import("../tabs/registry.js").TabRegistry} registry
   * @param {() => void} schedulePush
   */
  constructor(registry, schedulePush) {
    this.#registry     = registry;
    this.#schedulePush = schedulePush;
  }

  /**
   * Dispatch a single command.
   * @param {number} tabId
   * @param {string} action
   */
  async dispatch(tabId, action) {
    switch (action) {
      case Command.FOCUS_TAB:      return this.#focusTab(tabId);
      case Command.REACTIVATE_TAB: return this.#reactivateTab(tabId);
      case Command.RELOAD_TAB:     return this.#reloadTab(tabId);
      case Command.CLOSE_TAB:      return this.#closeTab(tabId);
    }

    // Media commands: only forward when the tab has a known media session.
    const meta = this.#registry.get(tabId);
    if (!meta?.media) return;

    try {
      await chrome.tabs.sendMessage(tabId, {
        type: MSG_MEDIA_CONTROL,
        action,
      });
    } catch {
      // Content script gone — clear stale media and push.
      if (this.#registry.clearMedia(tabId)) this.#schedulePush();
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** @type {import("../tabs/registry.js").TabRegistry} */
  #registry;

  /** @type {() => void} */
  #schedulePush;

  async #focusTab(tabId) {
    let tab;
    try { tab = await chrome.tabs.get(tabId); }
    catch { this.#evict(tabId); return; }

    // Unminimise the window first.
    try { await chrome.windows.update(tab.windowId, { focused: true, state: "normal" }); }
    catch { /* non-fatal */ }

    // Prefer highlight (supports multi-select) with update as fallback.
    try {
      await chrome.tabs.highlight({ windowId: tab.windowId, tabs: [tab.index] });
    } catch {
      try { await chrome.tabs.update(tabId, { active: true }); }
      catch { this.#evict(tabId); return; }
    }

    // Second focus call ensures the window comes to front on some OSes.
    try { await chrome.windows.update(tab.windowId, { focused: true }); }
    catch { /* non-fatal */ }
  }

  async #reactivateTab(tabId) {
    try { await chrome.tabs.get(tabId); }
    catch { this.#evict(tabId); return; }

    if (this.#registry.setTabState(tabId, TabState.LOADING)) this.#schedulePush();

    try {
      await chrome.tabs.reload(tabId, { bypassCache: false });
    } catch {
      try { await chrome.tabs.update(tabId, { active: true }); } catch { /* non-fatal */ }
    }

    await this.#focusTab(tabId);
  }

  async #reloadTab(tabId) {
    const changed =
      this.#registry.clearMedia(tabId) |
      this.#registry.setTabState(tabId, TabState.LOADING);
    if (changed) this.#schedulePush();

    try { await chrome.tabs.reload(tabId, { bypassCache: false }); }
    catch { /* tab may already be gone */ }
  }

  async #closeTab(tabId) {
    this.#evict(tabId);
    try { await chrome.tabs.remove(tabId); } catch { /* already closed */ }
  }

  #evict(tabId) {
    if (this.#registry.evict(tabId)) this.#schedulePush();
  }
}