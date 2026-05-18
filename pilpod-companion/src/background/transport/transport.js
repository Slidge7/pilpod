/**
 * POST tab state to Tauri and receive commands. No tab or command logic here.
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
   * @param {(commands: import("../../shared/protocol.js").DesktopCommand[]) => void|Promise<void>} onCommands
   */
  constructor(getPayload, onCommands) {
    this.#getPayload = getPayload;
    this.#onCommands = onCommands;
  }

  /** @type {() => import("../../shared/protocol.js").BrowserPayload} */
  #getPayload;

  /** @type {(commands: import("../../shared/protocol.js").DesktopCommand[]) => void|Promise<void>} */
  #onCommands;

  schedulePush() {
    if (this.#debounceTimer !== null) return;
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      void this.#push();
    }, DEBOUNCE_MS);
  }

  startHeartbeat() {
    if (this.#heartbeatTimer !== null) return;
    this.#heartbeatTimer = setInterval(() => void this.#push(), PUSH_INTERVAL_MS);
    void this.#push();
  }

  stopHeartbeat() {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }

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
      return;
    }

    if (!res.ok) return;

    /** @type {import("../../shared/protocol.js").DesktopResponse|null} */
    let data = null;
    try { data = await res.json(); } catch { return; }

    const commands = Array.isArray(data?.commands) ? data.commands : [];
    if (commands.length > 0) await this.#onCommands(commands);
  }
}
