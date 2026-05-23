/**
 * HTTP POST fallback transport for tab state and command polling.
 */

"use strict";

import {
  PUSH_URL,
  PUSH_INTERVAL_MS,
  DEBOUNCE_MS,
  FETCH_TIMEOUT_MS,
  FAIL_THRESHOLD,
  SLEEP_INTERVAL_MS,
} from "../../shared/constants.js";

export class HttpTransport {
  /** @type {ReturnType<typeof setTimeout>|null} */
  #debounceTimer = null;

  /** @type {ReturnType<typeof setInterval>|null} */
  #heartbeatTimer = null;

  /** @type {ReturnType<typeof setTimeout>|null} */
  #wakeTimer = null;

  /** @type {number} */
  #failCount = 0;

  /** @type {boolean} */
  #sleeping = false;

  /** @type {number} */
  #seq = 0;

  /**
   * @param {import("../tabs/registry.js").TabRegistry} registry
   * @param {() => string} getBrowserId
   * @param {() => string} getBrowserName
   * @param {(commands: import("../../shared/protocol.js").DesktopCommand[]) => void|Promise<void>} onCommands
   */
  constructor(registry, getBrowserId, getBrowserName, onCommands) {
    this.#registry = registry;
    this.#getBrowserId = getBrowserId;
    this.#getBrowserName = getBrowserName;
    this.#onCommands = onCommands;
  }

  /** @type {import("../tabs/registry.js").TabRegistry} */
  #registry;

  /** @type {() => string} */
  #getBrowserId;

  /** @type {() => string} */
  #getBrowserName;

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

  stop() {
    this.stopHeartbeat();
  }

  stopHeartbeat() {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }

  async #push() {
    if (this.#sleeping) return;

    const dirty = this.#registry.isDirty();
    /** @type {import("../../shared/protocol.js").BrowserPayload} */
    const payload = dirty
      ? {
          browserId:   this.#getBrowserId(),
          browserName: this.#getBrowserName(),
          tabs:        this.#registry.all(),
        }
      : {
          browserId: this.#getBrowserId(),
          ping:      true,
          seq:       this.#seq++,
        };

    let res;
    try {
      res = await fetch(PUSH_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      this.#onFailure();
      return;
    }

    if (!res.ok) {
      this.#onFailure();
      return;
    }

    this.#failCount = 0;
    this.#sleeping = false;

    if (dirty) this.#registry.clearDirty();

    /** @type {import("../../shared/protocol.js").DesktopResponse|null} */
    let data = null;
    try { data = await res.json(); } catch { return; }

    await this.#handleResponse(data);
  }

  /**
   * @param {import("../../shared/protocol.js").DesktopResponse|null} data
   */
  async #handleResponse(data) {
    const commands = Array.isArray(data?.commands) ? data.commands : [];
    if (commands.length > 0) await this.#onCommands(commands);

    if (data?.syncNow === true) {
      this.#registry.markDirty();
      void this.#push();
    }
  }

  #onFailure() {
    this.#failCount++;
    if (this.#failCount >= FAIL_THRESHOLD && !this.#sleeping) {
      this.#sleeping = true;
      if (this.#wakeTimer === null) {
        this.#wakeTimer = setTimeout(() => {
          this.#wakeTimer = null;
          void this.#wakeAndRetry();
        }, SLEEP_INTERVAL_MS);
      }
    }
  }

  async #wakeAndRetry() {
    this.#sleeping = false;
    await this.#push();
  }
}
