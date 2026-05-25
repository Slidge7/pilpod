/**
 * Popup ↔ background message bridge.
 */

"use strict";

import {
  addCustomRule,
  deleteRule,
  ignoreDomain,
  isDomainCovered,
  normalizeDomain,
  toggleRule,
} from "../shared/pilpodConfig.js";
import { originPatternsForDomain } from "../shared/staticMediaPatterns.js";
import { registerDomain } from "./dynamicInjection.js";
import { clearDiscoveryBadge, getPendingDiscovery } from "./discovery.js";
import { MSG_POPUP } from "../shared/protocol.js";

/** @type {object | null} */
let bridge = null;

/**
 * @param {object} deps
 * @param {() => import("../shared/pilpodConfig.js").PilPodConfig} deps.getConfig
 * @param {(config: import("../shared/pilpodConfig.js").PilPodConfig) => void} deps.setConfig
 * @param {() => string} deps.getConnectionState
 * @param {(config: import("../shared/pilpodConfig.js").PilPodConfig) => Promise<void>} deps.syncDynamicScripts
 * @param {() => import("./tabs/registry.js").TabRegistry} deps.getRegistry
 */
export function registerPopupBridge(deps) {
  bridge = deps;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== MSG_POPUP) return false;

    void handlePopupMessage(msg.action, msg.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));

    return true;
  });
}

/**
 * @param {string} action
 * @param {object} [payload]
 */
async function handlePopupMessage(action, payload = {}) {
  if (!bridge) throw new Error("Popup bridge not initialized");

  const config = bridge.getConfig();

  switch (action) {
    case "GET_STATE": {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = activeTab?.id;
      const url = activeTab?.url ?? "";
      const covered = isDomainCovered(url, config);
      const pendingHostname = tabId != null ? getPendingDiscovery().get(tabId) : undefined;
      const registry = bridge.getRegistry();
      const tabPost = tabId != null ? registry.get(tabId) : null;

      return {
        connectionState: bridge.getConnectionState(),
        activeTab: activeTab
          ? {
              tabId: activeTab.id,
              title: activeTab.title ?? "",
              url,
              audible: activeTab.audible ?? false,
              covered,
              hasMedia: tabPost?.media != null,
              pendingHostname: pendingHostname ?? null,
            }
          : null,
        config,
      };
    }

    case "ADD_DOMAIN": {
      const domain = normalizeDomain(String(payload.domain ?? ""));
      if (!domain) throw new Error("Domain required");

      const granted = await chrome.permissions.request({
        origins: originPatternsForDomain(domain),
      });
      if (!granted) throw new Error("Permission denied");

      const next = await registerDomain(domain, config);
      bridge.setConfig(next);

      const tabId = payload.tabId;
      if (typeof tabId === "number") {
        clearDiscoveryBadge(tabId);
        await chrome.tabs.reload(tabId);
      }

      return { config: next };
    }

    case "DISMISS_DOMAIN": {
      const domain = normalizeDomain(String(payload.domain ?? ""));
      const next = await ignoreDomain(domain, config);
      bridge.setConfig(next);

      const tabId = payload.tabId;
      if (typeof tabId === "number") clearDiscoveryBadge(tabId);

      return { config: next };
    }

    case "TOGGLE_RULE": {
      const next = await toggleRule(String(payload.id ?? ""), config);
      bridge.setConfig(next);
      await bridge.syncDynamicScripts(next);
      return { config: next };
    }

    case "DELETE_RULE": {
      const next = await deleteRule(String(payload.id ?? ""), config);
      bridge.setConfig(next);
      await bridge.syncDynamicScripts(next);
      return { config: next };
    }

    case "ADD_RULE_MANUAL": {
      const domain = normalizeDomain(String(payload.domain ?? ""));
      const granted = await chrome.permissions.request({
        origins: originPatternsForDomain(domain),
      });
      if (!granted) throw new Error("Permission denied");

      let next = await addCustomRule(domain, config);
      bridge.setConfig(next);
      await bridge.syncDynamicScripts(next);
      return { config: next };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
