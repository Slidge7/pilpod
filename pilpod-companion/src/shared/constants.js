/**
 * Runtime configuration shared across the extension.
 * Tune values here — not at call sites.
 */

"use strict";

/** Local Tauri app endpoint for tab state pushes and command polling. */
export const PUSH_URL = "http://127.0.0.1:17399/browser-tabs";

/** Bridge capabilities endpoint (Rust source of truth for timing). */
export const CAPABILITIES_URL = "http://127.0.0.1:17399/capabilities";

/** Default protocol major version sent on every POST/WS frame. */
export const PROTOCOL_VERSION = "1";

/** Primary WebSocket bridge endpoint. */
export const WS_URL = "ws://127.0.0.1:17400/ws";

/** Max wait for initial WebSocket connect before HTTP fallback. */
export const WS_CONNECT_TIMEOUT_MS = 2000;

/** Delay before reconnecting a dropped WebSocket. */
export const WS_RECONNECT_MS = 3000;

/** Periodic heartbeat + command poll interval (ms). */
export const PUSH_INTERVAL_MS = 250;

/** Debounce window for event-triggered pushes (ms). */
export const DEBOUNCE_MS = 60;

/** Fetch timeout for each push (ms). */
export const FETCH_TIMEOUT_MS = 800;

/** Consecutive failures before backing off POSTs. */
export const FAIL_THRESHOLD = 4;

/** Retry interval when desktop is unreachable (ms). */
export const SLEEP_INTERVAL_MS = 2000;

/** chrome.storage key for the stable browser profile UUID. */
export const STORAGE_KEY_BROWSER_ID = "pilpodBrowserId";

/** chrome.storage key for v2 PilPod configuration. */
export const STORAGE_KEY_CONFIG = "pilpodConfig";

/** @deprecated Content script uses event-driven detection; kept for reference only. */
export const CONTENT_TICK_MS = 800;
