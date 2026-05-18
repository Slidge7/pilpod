/**
 * Service worker entry — wires registry, transport, commands, and lifecycle.
 */

"use strict";

import { detectBrowserName }          from "./shared/browser.js";
import { STORAGE_KEY_BROWSER_ID }     from "./shared/constants.js";
import { TabRegistry }                from "./background/tabs/registry.js";
import { Transport }                  from "./background/transport/transport.js";
import { CommandHandler }             from "./background/commands/commandHandler.js";
import { registerLifecycleListeners } from "./background/tabs/lifecycle.js";

let browserId = crypto.randomUUID();
const browserName = detectBrowserName();

const registry = new TabRegistry();

const commandHandler = new CommandHandler(registry, () => transport.schedulePush());

const transport = new Transport(
  () => ({ browserId, browserName, tabs: registry.all() }),
  async (commands) => {
    for (const c of commands) {
      const tabId  = c?.tabId;
      const action = String(c?.action ?? "");
      if (tabId == null || !action) continue;
      await commandHandler.dispatch(tabId, action);
    }
  },
);

// Register listeners before async init so content-script snapshots are not dropped.
registerLifecycleListeners(registry, () => transport.schedulePush());

async function init() {
  await _loadBrowserId();
  await _seedTabs();
  await _seedFocusedWindow();
  transport.startHeartbeat();
}

function _loadBrowserId() {
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

function _seedTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      registry.seed(tabs);
      resolve();
    });
  });
}

function _seedFocusedWindow() {
  return new Promise((resolve) => {
    chrome.windows.getLastFocused({ populate: false }, (win) => {
      if (win && win.id !== chrome.windows.WINDOW_ID_NONE) {
        registry.setFocusedWindow(win.id);
      }
      resolve();
    });
  });
}

void init();
