/**
 * @file transport.js
 * Handles all communication with the Rust/Tauri desktop app:
 *   - Serialises + POSTs the full tab state
 *   - Deserialises + returns the command list
 *   - Debounce-aware `schedulePush` for event-driven batching
 *   - Periodic heartbeat via `startHeartbeat`
 *
 * The module intentionally has no knowledge of tab management or command
 * routing — it only moves bytes.
 */

"use strict";

import {
  PUSH_URL,
  PUSH_INTERVAL_MS,
  DEBOUNCE_MS,
  FETCH_TIMEOUT_MS,
} from "../../shared/constants.js";

export class Transport {
  /** @type {ReturnType<typeof setTimeout>|null} */
  #debounceTimer = null;

  /** @type {ReturnType<typeof setInterval>|null} */
  #heartbeatTimer = null;

  /**
   * @param {() => import("../../shared/protocol.js").BrowserPayload} getPayload
   *   Called each time a push fires; must return the current state snapshot.
   * @param {(commands: import("../../shared/protocol.js").DesktopCommand[]) => void} onCommands
   *   Called with any commands returned by the desktop app.
   */
  constructor(getPayload, onCommands) {
    this.#getPayload  = getPayload;
    this.#onCommands  = onCommands;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Schedule an imminent push (debounced).
   * Multiple calls within DEBOUNCE_MS collapse into a single fetch.
   */
  schedulePush() {
    if (this.#debounceTimer !== null) return;
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      void this.#push();
    }, DEBOUNCE_MS);
  }

  /** Start the periodic heartbeat. Call once during init. */
  startHeartbeat() {
    if (this.#heartbeatTimer !== null) return; // idempotent
    this.#heartbeatTimer = setInterval(() => void this.#push(), PUSH_INTERVAL_MS);
    void this.#push(); // immediate first push
  }

  /** Stop the periodic heartbeat (useful in tests). */
  stopHeartbeat() {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** @type {() => import("../../shared/protocol.js").BrowserPayload} */
  #getPayload;

  /** @type {(commands: import("../../shared/protocol.js").DesktopCommand[]) => void} */
  #onCommands;

  async #push() {
    const payload = this.#getPayload();

    let res;
    try {
      res = await fetch(PUSH_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      // Silently discard — Tauri app may not be running yet.
      return;
    }

    if (!res.ok) return;

    /** @type {import("../../shared/protocol.js").DesktopResponse|null} */
    let data = null;
    try { data = await res.json(); } catch { return; }

    const commands = Array.isArray(data?.commands) ? data.commands : [];
    if (commands.length > 0) this.#onCommands(commands);
  }
}