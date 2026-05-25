/**
 * PilPod v2 configuration stored in chrome.storage.local.
 */

"use strict";

import { STORAGE_KEY_BROWSER_ID, STORAGE_KEY_CONFIG } from "./constants.js";
import {
  hostnameFromUrl,
  hostnameMatchesHost,
  isValidDomain,
  urlMatchesStaticPatterns,
} from "./staticMediaPatterns.js";

/**
 * @typedef {object} CustomRule
 * @property {string} id
 * @property {string} domain
 * @property {boolean} enabled
 * @property {number} dateAdded
 */

/**
 * @typedef {object} PilPodConfig
 * @property {string} browserId
 * @property {CustomRule[]} customRules
 * @property {string[]} ignoredDomains
 */

/**
 * @returns {Promise<string>}
 */
export async function getExistingBrowserId() {
  const result = await chrome.storage.local.get([
    STORAGE_KEY_CONFIG,
    STORAGE_KEY_BROWSER_ID,
  ]);

  if (result?.[STORAGE_KEY_CONFIG]?.browserId) {
    return String(result[STORAGE_KEY_CONFIG].browserId);
  }
  if (result?.[STORAGE_KEY_BROWSER_ID]) {
    return String(result[STORAGE_KEY_BROWSER_ID]);
  }
  return crypto.randomUUID();
}

/**
 * @returns {Promise<PilPodConfig>}
 */
export async function loadConfig() {
  const result = await chrome.storage.local.get([STORAGE_KEY_CONFIG]);
  const stored = result?.[STORAGE_KEY_CONFIG];
  if (stored && typeof stored.browserId === "string") {
    return {
      browserId: stored.browserId,
      customRules: Array.isArray(stored.customRules) ? stored.customRules : [],
      ignoredDomains: Array.isArray(stored.ignoredDomains) ? stored.ignoredDomains : [],
    };
  }

  const browserId = await getExistingBrowserId();
  return {
    browserId,
    customRules: [],
    ignoredDomains: [],
  };
}

/**
 * @param {Partial<PilPodConfig>} partial
 * @returns {Promise<PilPodConfig>}
 */
export async function saveConfig(partial) {
  const current = await loadConfig();
  const next = {
    ...current,
    ...partial,
    customRules: partial.customRules ?? current.customRules,
    ignoredDomains: partial.ignoredDomains ?? current.ignoredDomains,
  };
  await chrome.storage.local.set({ [STORAGE_KEY_CONFIG]: next });
  return next;
}

/**
 * @param {string} domain
 * @returns {Promise<PilPodConfig>}
 */
export async function migrateToV2Config() {
  const browserId = await getExistingBrowserId();
  const config = {
    browserId,
    customRules: [],
    ignoredDomains: [],
  };
  await chrome.storage.local.set({
    [STORAGE_KEY_CONFIG]: config,
    [STORAGE_KEY_BROWSER_ID]: browserId,
  });
  return config;
}

/**
 * @param {string} domain
 * @returns {string}
 */
export function normalizeDomain(domain) {
  const hostname = hostnameFromUrl(`https://${String(domain ?? "").trim()}`);
  if (hostname) return hostname;
  return String(domain ?? "").trim().replace(/^www\./i, "").toLowerCase();
}

/**
 * @param {string} domain
 * @returns {string}
 */
export function ruleIdForDomain(domain) {
  return `pilpod-custom-${normalizeDomain(domain).replace(/\./g, "-")}`;
}

/**
 * @param {string} url
 * @param {PilPodConfig} config
 * @returns {boolean}
 */
export function isDomainCovered(url, config) {
  if (urlMatchesStaticPatterns(url)) return true;

  const hostname = hostnameFromUrl(url);
  if (!hostname) return false;

  if (config.ignoredDomains.some((d) => hostnameMatchesHost(hostname, d))) {
    return false;
  }

  return config.customRules.some(
    (rule) => rule.enabled && hostnameMatchesHost(hostname, rule.domain),
  );
}

/**
 * @param {string} domain
 * @param {PilPodConfig} config
 * @returns {Promise<PilPodConfig>}
 */
export async function addCustomRule(domain, config) {
  const normalized = normalizeDomain(domain);
  if (!isValidDomain(normalized)) {
    throw new Error("Invalid domain");
  }

  const existing = config.customRules.find((r) => r.domain === normalized);
  const customRules = existing
    ? config.customRules.map((r) =>
        r.domain === normalized ? { ...r, enabled: true } : r,
      )
    : [
        ...config.customRules,
        {
          id: ruleIdForDomain(normalized),
          domain: normalized,
          enabled: true,
          dateAdded: Date.now(),
        },
      ];

  const ignoredDomains = config.ignoredDomains.filter(
    (d) => !hostnameMatchesHost(normalized, d),
  );

  return saveConfig({ ...config, customRules, ignoredDomains });
}

/**
 * @param {string} id
 * @param {PilPodConfig} config
 * @returns {Promise<PilPodConfig>}
 */
export async function toggleRule(id, config) {
  const customRules = config.customRules.map((r) =>
    r.id === id ? { ...r, enabled: !r.enabled } : r,
  );
  return saveConfig({ ...config, customRules });
}

/**
 * @param {string} id
 * @param {PilPodConfig} config
 * @returns {Promise<PilPodConfig>}
 */
export async function deleteRule(id, config) {
  const customRules = config.customRules.filter((r) => r.id !== id);
  return saveConfig({ ...config, customRules });
}

/**
 * @param {string} domain
 * @param {PilPodConfig} config
 * @returns {Promise<PilPodConfig>}
 */
export async function ignoreDomain(domain, config) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return config;

  const ignoredDomains = config.ignoredDomains.includes(normalized)
    ? config.ignoredDomains
    : [...config.ignoredDomains, normalized];

  return saveConfig({ ...config, ignoredDomains });
}
