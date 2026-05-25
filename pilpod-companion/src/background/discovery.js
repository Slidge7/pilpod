/**
 * Audible-tab discovery — badge prompts for unknown media sites.
 */

"use strict";

import { hostnameFromUrl } from "../shared/staticMediaPatterns.js";
import { isDomainCovered } from "../shared/pilpodConfig.js";

/** @type {Map<number, string>} tabId → hostname pending discovery */
const pendingDiscovery = new Map();

/**
 * @returns {Map<number, string>}
 */
export function getPendingDiscovery() {
  return pendingDiscovery;
}

/**
 * @param {number} tabId
 */
export function clearDiscoveryBadge(tabId) {
  pendingDiscovery.delete(tabId);
  chrome.action.setBadgeText({ text: "", tabId });
}

/**
 * @param {() => import("../shared/pilpodConfig.js").PilPodConfig | undefined} getConfig
 * @param {() => void} schedulePush
 */
export function registerDiscoveryListeners(getConfig, schedulePush) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const config = getConfig();
    if (!config) return;

    const url = tab?.url ?? changeInfo.url ?? "";
    const hostname = hostnameFromUrl(url);

    if (changeInfo.audible === false || (changeInfo.audible === undefined && tab?.audible === false)) {
      clearDiscoveryBadge(tabId);
      return;
    }

    if (hostname && isDomainCovered(url, config)) {
      clearDiscoveryBadge(tabId);
      return;
    }

    const audible = changeInfo.audible === true || tab?.audible === true;
    if (!audible || !hostname) return;

    if (config.ignoredDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
      return;
    }

    pendingDiscovery.set(tabId, hostname);
    chrome.action.setBadgeText({ text: "+", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#2563eb", tabId });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    pendingDiscovery.delete(tabId);
  });

  // Re-use schedulePush hook so discovery stays wired even if unused directly.
  void schedulePush;
}

export { clearDiscoveryBadge as dismissDiscoveryForTab };
