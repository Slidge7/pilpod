/**
 * Service worker entry — wires registry, transport, commands, and lifecycle.
 */

"use strict";

import { detectBrowserName }          from "./shared/browser.js";
import { STORAGE_KEY_BROWSER_ID }     from "./shared/constants.js";
import { TabRegistry }                from "./background/tabs/registry.js";
import { HttpTransport }              from "./background/transport/httpTransport.js";
import { WsTransport }                from "./background/transport/wsTransport.js";
import { CommandHandler }             from "./background/commands/commandHandler.js";
import { registerLifecycleListeners } from "./background/tabs/lifecycle.js";

let browserId = crypto.randomUUID();
const browserName = detectBrowserName();

const registry = new TabRegistry();

/** @type {HttpTransport|WsTransport|null} */
let transport = null;

const commandHandler = new CommandHandler(registry, () => transport?.schedulePush());

async function initTransport() {
  const onCommands = async (commands) => {
    for (const c of commands) {
      const tabId  = c?.tabId;
      const action = String(c?.action ?? "");
      if (tabId == null || !action) continue;
      await commandHandler.dispatch(tabId, action);
    }
  };

  const ws = new WsTransport(
    registry,
    () => browserId,
    () => browserName,
    onCommands,
  );

  ws.connect();
  try {
    await ws.waitForReady();
    return ws;
  } catch {
    ws.stop();
    const http = new HttpTransport(
      registry,
      () => browserId,
      () => browserName,
      onCommands,
    );
    http.startHeartbeat();
    return http;
  }
}

registerLifecycleListeners(registry, () => transport?.schedulePush());

async function init() {
  await _loadBrowserId();
  await _seedTabs();
  await _seedFocusedWindow();
  registry.markDirty();
  transport = await initTransport();
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
