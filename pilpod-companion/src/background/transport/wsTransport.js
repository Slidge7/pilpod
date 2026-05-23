/**
 * WebSocket transport — primary path to the PilPod desktop bridge.
 */

"use strict";

import {
  WS_URL,
  PUSH_INTERVAL_MS,
  DEBOUNCE_MS,
  WS_RECONNECT_MS,
  WS_CONNECT_TIMEOUT_MS,
} from "../../shared/constants.js";

export class WsTransport {
  /** @type {WebSocket|null} */
  #ws = null;

  /** @type {ReturnType<typeof setTimeout>|null} */
  #debounceTimer = null;

  /** @type {ReturnType<typeof setInterval>|null} */
  #heartbeatTimer = null;

  /** @type {ReturnType<typeof setTimeout>|null} */
  #reconnectTimer = null;

  /** @type {number} */
  #seq = 0;

  /** @type {boolean} */
  #stopped = false;

  /** @type {(() => void)|null} */
  #readyResolve = null;

  /** @type {Promise<void>} */
  #readyPromise = Promise.reject(new Error("not connected"));

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

  connect() {
    this.#stopped = false;
    this.#openSocket();
  }

  waitForReady(timeoutMs = WS_CONNECT_TIMEOUT_MS) {
    return Promise.race([
      this.#readyPromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("ws connect timeout")), timeoutMs);
      }),
    ]);
  }

  schedulePush() {
    if (this.#debounceTimer !== null) return;
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      this.#push();
    }, DEBOUNCE_MS);
  }

  startHeartbeat() {
    if (this.#heartbeatTimer !== null) return;
    this.#heartbeatTimer = setInterval(() => this.#push(), PUSH_INTERVAL_MS);
    this.#push();
  }

  stop() {
    this.#stopped = true;
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  #openSocket() {
    this.#readyPromise = new Promise((resolve) => {
      this.#readyResolve = resolve;
    });

    const ws = new WebSocket(WS_URL);
    this.#ws = ws;

    ws.onopen = () => {
      this.#readyResolve?.();
      this.#readyResolve = null;
      this.startHeartbeat();
    };

    ws.onmessage = (event) => {
      /** @type {import("../../shared/protocol.js").DesktopResponse|null} */
      let data = null;
      try {
        data = JSON.parse(String(event.data ?? ""));
      } catch {
        return;
      }
      void this.#handleResponse(data);
    };

    ws.onclose = () => {
      if (this.#stopped) return;
      if (this.#heartbeatTimer !== null) {
        clearInterval(this.#heartbeatTimer);
        this.#heartbeatTimer = null;
      }
      this.#scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires after onerror
    };
  }

  #scheduleReconnect() {
    if (this.#stopped || this.#reconnectTimer !== null) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#openSocket();
    }, WS_RECONNECT_MS);
  }

  #push() {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;

    const dirty = this.#registry.isDirty();
    const payload = dirty
      ? {
          type:        "sync",
          browserId:   this.#getBrowserId(),
          browserName: this.#getBrowserName(),
          tabs:        this.#registry.all(),
        }
      : {
          type:      "ping",
          browserId: this.#getBrowserId(),
          seq:       this.#seq++,
        };

    this.#ws.send(JSON.stringify(payload));
    if (dirty) this.#registry.clearDirty();
  }

  /**
   * @param {import("../../shared/protocol.js").DesktopResponse|null} data
   */
  async #handleResponse(data) {
    const commands = Array.isArray(data?.commands) ? data.commands : [];
    if (commands.length > 0) await this.#onCommands(commands);

    if (data?.syncNow === true) {
      this.#registry.markDirty();
      this.#push();
    }
  }
}
