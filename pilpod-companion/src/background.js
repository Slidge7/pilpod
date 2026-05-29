/**
 * Service worker entry — wires registry, transport, commands, and lifecycle.
 */

"use strict";

import { detectBrowserName }          from "./shared/browser.js";
import { loadBridgeConfig }           from "./shared/bridgeConfig.js";
import { loadConfig, migrateToV2Config, saveConfig } from "./shared/pilpodConfig.js";
import { STORAGE_KEY_CONFIG } from "./shared/constants.js";
import { TabRegistry }                from "./background/tabs/registry.js";
import { HttpTransport }              from "./background/transport/httpTransport.js";
import { WsTransport }                from "./background/transport/wsTransport.js";
import { CommandHandler }             from "./background/commands/commandHandler.js";
import { registerLifecycleListeners } from "./background/tabs/lifecycle.js";
import { syncDynamicContentScripts, setCachedConfig } from "./background/dynamicInjection.js";
import { registerPopupBridge }        from "./background/popupBridge.js";
import { registerDiscoveryListeners } from "./background/discovery.js";
import { registerStandalonePopupBridge } from "./background/standalonePopupBridge.js";

/** @type {import("./shared/pilpodConfig.js").PilPodConfig} */
let pilpodConfig;

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

function nudgeTransport() {
  if (transport && typeof transport.wake === "function") {
    transport.wake();
  } else if (transport && typeof transport.schedulePush === "function") {
    transport.schedulePush();
  }
}

function getConnectionState() {
  if (!transport) return "disconnected";
  if (typeof transport.getConnectionState === "function") {
    return transport.getConnectionState();
  }
  return "disconnected";
}

registerLifecycleListeners(registry, () => transport?.schedulePush());
registerDiscoveryListeners(() => pilpodConfig, () => transport?.schedulePush());
registerPopupBridge({
  getConfig: () => pilpodConfig,
  setConfig: (config) => {
    pilpodConfig = config;
    setCachedConfig(config);
  },
  getConnectionState,
  syncDynamicScripts: syncDynamicContentScripts,
  getRegistry: () => registry,
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (
    details.reason === "install" ||
    (details.reason === "update" && details.previousVersion?.startsWith("1."))
  ) {
    pilpodConfig = await migrateToV2Config();
  } else {
    pilpodConfig = await loadConfig();
  }
  browserId = pilpodConfig.browserId;
  setCachedConfig(pilpodConfig);
  await syncDynamicContentScripts(pilpodConfig);
});

chrome.runtime.onStartup.addListener(() => {
  nudgeTransport();
});

chrome.alarms.create("pilpod-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "pilpod-keepalive") {
    nudgeTransport();
  }
});

async function init() {
  pilpodConfig = await loadConfig();
  if (!(await chrome.storage.local.get([STORAGE_KEY_CONFIG]))?.[STORAGE_KEY_CONFIG]) {
    pilpodConfig = await saveConfig(pilpodConfig);
  }
  browserId = pilpodConfig.browserId;
  setCachedConfig(pilpodConfig);
  await syncDynamicContentScripts(pilpodConfig);
  await _seedTabs();
  await _seedFocusedWindow();
  await loadBridgeConfig();
  registry.markDirty();
  transport = await initTransport();
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

registerStandalonePopupBridge();

void init();
