/**
 * Runtime configuration shared across the extension.
 * Tune values here — not at call sites.
 */

"use strict";

/** Local Tauri app endpoint for tab state pushes and command polling. */
export const PUSH_URL = "http://127.0.0.1:17399/browser-tabs";

/** Periodic heartbeat + command poll interval (ms). */
export const PUSH_INTERVAL_MS = 250;

/** Debounce window for event-triggered pushes (ms). */
export const DEBOUNCE_MS = 60;

/** Fetch timeout for each push (ms). */
export const FETCH_TIMEOUT_MS = 800;

/** chrome.storage key for the stable browser profile UUID. */
export const STORAGE_KEY_BROWSER_ID = "pilpodBrowserId";

/** Content script tick rate (ms). */
export const CONTENT_TICK_MS = 800;
