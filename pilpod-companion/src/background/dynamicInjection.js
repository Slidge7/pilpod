/**
 * Dynamic content script registration for user-approved custom domains.
 */

"use strict";

import { originPatternsForDomain } from "../shared/staticMediaPatterns.js";

const CUSTOM_SCRIPT_PREFIX = "pilpod-custom-";

/** @type {import("../shared/pilpodConfig.js").PilPodConfig | null} */
let cachedConfig = null;

/**
 * @param {import("../shared/pilpodConfig.js").PilPodConfig} config
 */
export function setCachedConfig(config) {
  cachedConfig = config;
}

/**
 * @returns {import("../shared/pilpodConfig.js").PilPodConfig | null}
 */
export function getCachedConfig() {
  return cachedConfig;
}

/**
 * @param {import("../shared/pilpodConfig.js").CustomRule} rule
 * @returns {chrome.scripting.RegisteredContentScript}
 */
export function buildRegisteredScript(rule) {
  return {
    id: rule.id.startsWith(CUSTOM_SCRIPT_PREFIX) ? rule.id : `${CUSTOM_SCRIPT_PREFIX}${rule.id}`,
    matches: originPatternsForDomain(rule.domain),
    js: ["dist/content.js"],
    runAt: "document_start",
    allFrames: true,
    matchOriginAsFallback: true,
    matchAboutBlank: true,
    persistAcrossSessions: true,
  };
}

/**
 * @returns {Promise<void>}
 */
export async function syncDynamicContentScripts(config) {
  cachedConfig = config;

  const existing = await chrome.scripting.getRegisteredContentScripts();
  const toRemove = existing
    .filter((s) => s.id.startsWith(CUSTOM_SCRIPT_PREFIX))
    .map((s) => s.id);

  if (toRemove.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: toRemove });
  }

  const enabled = config.customRules.filter((r) => r.enabled);
  if (enabled.length === 0) return;

  await chrome.scripting.registerContentScripts(
    enabled.map((rule) => buildRegisteredScript(rule)),
  );
}

/**
 * @param {string} domain
 * @param {import("../shared/pilpodConfig.js").PilPodConfig} config
 * @returns {Promise<import("../shared/pilpodConfig.js").PilPodConfig>}
 */
export async function registerDomain(domain, config) {
  const { addCustomRule } = await import("../shared/pilpodConfig.js");
  const next = await addCustomRule(domain, config);
  await syncDynamicContentScripts(next);
  return next;
}

export { CUSTOM_SCRIPT_PREFIX };
