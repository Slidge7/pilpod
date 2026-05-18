/**
 * Route Rust commands to tab actions or content-script media controls.
 */

"use strict";

import { Command, MSG_MEDIA_CONTROL, TabState } from "../../shared/protocol.js";

export class CommandHandler {
  /**
   * @param {import("../tabs/registry.js").TabRegistry} registry
   * @param {() => void} schedulePush
   */
  constructor(registry, schedulePush) {
    this.#registry     = registry;
    this.#schedulePush = schedulePush;
  }

  /** @type {import("../tabs/registry.js").TabRegistry} */
  #registry;

  /** @type {() => void} */
  #schedulePush;

  /**
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

    const meta = this.#registry.get(tabId);
    if (!meta?.media) return;

    try {
      await chrome.tabs.sendMessage(tabId, {
        type: MSG_MEDIA_CONTROL,
        action,
      });
    } catch {
      if (this.#registry.clearMedia(tabId)) this.#schedulePush();
    }
  }

  async #focusTab(tabId) {
    let tab;
    try { tab = await chrome.tabs.get(tabId); }
    catch { this.#evict(tabId); return; }

    try { await chrome.windows.update(tab.windowId, { focused: true, state: "normal" }); }
    catch { /* non-fatal */ }

    try {
      await chrome.tabs.highlight({ windowId: tab.windowId, tabs: [tab.index] });
    } catch {
      try { await chrome.tabs.update(tabId, { active: true }); }
      catch { this.#evict(tabId); return; }
    }

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
      this.#registry.clearMedia(tabId) ||
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
