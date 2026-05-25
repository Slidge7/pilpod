/**
 * Runtime bridge configuration — seeded from constants.js, overridden by
 * GET /capabilities when PilPod is reachable.
 */

"use strict";

import {
  CAPABILITIES_URL,
  PROTOCOL_VERSION,
  PUSH_URL,
  WS_URL,
  PUSH_INTERVAL_MS,
  DEBOUNCE_MS,
  FETCH_TIMEOUT_MS,
  FAIL_THRESHOLD,
  SLEEP_INTERVAL_MS,
  WS_CONNECT_TIMEOUT_MS,
  WS_RECONNECT_MS,
} from "./constants.js";

/** @type {import("./bridgeConfig.types.js").BridgeConfig} */
const config = {
  protocolVersion:    PROTOCOL_VERSION,
  pushUrl:            PUSH_URL,
  wsUrl:              WS_URL,
  pushIntervalMs:     PUSH_INTERVAL_MS,
  debounceMs:         DEBOUNCE_MS,
  fetchTimeoutMs:     FETCH_TIMEOUT_MS,
  failThreshold:      FAIL_THRESHOLD,
  sleepIntervalMs:    SLEEP_INTERVAL_MS,
  wsConnectTimeoutMs: WS_CONNECT_TIMEOUT_MS,
  wsReconnectMs:      WS_RECONNECT_MS,
};

/**
 * @param {string} urlString
 * @param {{ allowWs?: boolean }} [opts]
 * @returns {boolean}
 */
export function isAllowedLocalhostUrl(urlString, opts = {}) {
  try {
    const url = new URL(urlString);
    if (url.hostname !== "127.0.0.1") return false;
    if (opts.allowWs) return url.protocol === "ws:" || url.protocol === "http:";
    return url.protocol === "http:";
  } catch {
    return false;
  }
}

/** @returns {Readonly<import("./bridgeConfig.types.js").BridgeConfig>} */
export function getBridgeConfig() {
  return config;
}

/**
 * Fetch server capabilities and merge into runtime config.
 * Keeps defaults when PilPod is offline or the request fails.
 * WebSocket URL overrides are rejected for CWS security.
 * @returns {Promise<Readonly<import("./bridgeConfig.types.js").BridgeConfig>>}
 */
export async function loadBridgeConfig() {
  try {
    const res = await fetch(CAPABILITIES_URL, {
      signal: AbortSignal.timeout(WS_CONNECT_TIMEOUT_MS),
    });
    if (!res.ok) return config;

    /** @type {Record<string, unknown>} */
    const data = await res.json();

    if (typeof data.protocolVersion === "string" && data.protocolVersion.length > 0) {
      config.protocolVersion = data.protocolVersion;
    }

    if (typeof data.httpPath === "string" && data.httpPath.length > 0) {
      const candidate = `http://127.0.0.1:17399${data.httpPath}`;
      if (isAllowedLocalhostUrl(candidate)) {
        config.pushUrl = candidate;
      }
    }

    const numericFields = [
      ["pushIntervalMs",     "pushIntervalMs"],
      ["debounceMs",         "debounceMs"],
      ["fetchTimeoutMs",     "fetchTimeoutMs"],
      ["failThreshold",      "failThreshold"],
      ["sleepIntervalMs",    "sleepIntervalMs"],
      ["wsConnectTimeoutMs", "wsConnectTimeoutMs"],
      ["wsReconnectMs",      "wsReconnectMs"],
    ];

    for (const [src, dst] of numericFields) {
      const v = data[src];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        config[dst] = v;
      }
    }
  } catch {
    // Desktop unreachable — use bundled defaults.
  }

  return config;
}

/** @returns {string} */
export function getValidatedWsUrl() {
  return isAllowedLocalhostUrl(config.wsUrl, { allowWs: true }) ? config.wsUrl : WS_URL;
}

/** Resets runtime config to bundled defaults — for tests only. */
export function resetBridgeConfigForTests() {
  config.protocolVersion = PROTOCOL_VERSION;
  config.pushUrl = PUSH_URL;
  config.wsUrl = WS_URL;
  config.pushIntervalMs = PUSH_INTERVAL_MS;
  config.debounceMs = DEBOUNCE_MS;
  config.fetchTimeoutMs = FETCH_TIMEOUT_MS;
  config.failThreshold = FAIL_THRESHOLD;
  config.sleepIntervalMs = SLEEP_INTERVAL_MS;
  config.wsConnectTimeoutMs = WS_CONNECT_TIMEOUT_MS;
  config.wsReconnectMs = WS_RECONNECT_MS;
}

/**
 * @param {Record<string, unknown>} data
 */
export function applyCapabilitiesForTests(data) {
  if (typeof data.protocolVersion === "string" && data.protocolVersion.length > 0) {
    config.protocolVersion = data.protocolVersion;
  }
  if (typeof data.wsUrl === "string" && data.wsUrl.length > 0) {
    if (isAllowedLocalhostUrl(data.wsUrl, { allowWs: true })) {
      config.wsUrl = data.wsUrl;
    }
  }
  if (typeof data.httpPath === "string" && data.httpPath.length > 0) {
    const candidate = `http://127.0.0.1:17399${data.httpPath}`;
    if (isAllowedLocalhostUrl(candidate)) {
      config.pushUrl = candidate;
    }
  }
}
