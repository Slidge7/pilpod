/**
 * @file background.js  (service worker entry point)
 * PilPod Background Service Worker
 * ----------------------------------
 * Orchestrates the extension's three subsystems:
 *   1. TabRegistry       — in-memory map of every open tab + media state
 *   2. Transport         — serialise & POST state to Tauri; poll for commands
 *   3. CommandHandler    — route Tauri commands to tab actions or content scripts
 *
 * Lifecycle:
 *   init() → seed registry from live tabs → start transport heartbeat
 *           → register all chrome event listeners
 *
 * See src/shared/protocol.js for the Rust ↔ extension wire format.
 */

"use strict";

import { detectBrowserName }           from "./shared/browser.js";
import { STORAGE_KEY_BROWSER_ID }      from "./shared/constants.js";
import { TabRegistry }                 from "./background/tabs/registry.js";
import { Transport }                   from "./background/transport/transport.js";
import { CommandHandler }              from "./background/commands/commandHandler.js";
import { registerLifecycleListeners }  from "./background/tabs/lifecycle.js";

// ─── Singletons ───────────────────────────────────────────────────────────────

/**
 * Stable UUID for this browser profile.
 * Generated synchronously so the first push is never delayed;
 * replaced with the stored value once storage resolves.
 */
let browserId = crypto.randomUUID();

/** Immutable after startup. */
const browserName = detectBrowserName();

const registry = new TabRegistry();

const transport = new Transport(
  // getPayload — called on every push
  () => ({ browserId, browserName, tabs: registry.all() }),

  // onCommands — called when Tauri responds with work to do
  async (commands) => {
    for (const c of commands) {
      const tabId  = c?.tabId;
      const action = String(c?.action ?? "");
      if (tabId == null || !action) continue;
      await commandHandler.dispatch(tabId, action);
    }
  },
);

const commandHandler = new CommandHandler(registry, () => transport.schedulePush());

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // 1. Restore or persist the stable browser UUID.
  await _loadBrowserId();

  // 2. Seed registry with all tabs that are already open.
  await _seedTabs();

  // 3. Seed the focused window.
  await _seedFocusedWindow();

  // 4. Wire up all chrome event listeners.
  registerLifecycleListeners(registry, () => transport.schedulePush());

  // 5. Start heartbeat (sends first push immediately).
  transport.startHeartbeat();
}

async function _loadBrowserId() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_BROWSER_ID], (result) => {
      if (result?.[STORAGE_KEY_BROWSER_ID]) {
        browserId = result[STORAGE_KEY_BROWSER_ID];
      } else {
        chrome.storage.local.set({ [STORAGE_KEY_BROWSER_ID]: browserId });
      }
      resolve();
    });
  });
}

async function _seedTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      registry.seed(tabs);
      resolve();
    });
  });
}

async function _seedFocusedWindow() {
  return new Promise((resolve) => {
    chrome.windows.getLastFocused({ populate: false }, (win) => {
      if (win && win.id !== chrome.windows.WINDOW_ID_NONE) {
        registry.setFocusedWindow(win.id);
      }
      resolve();
    });
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

void init();
