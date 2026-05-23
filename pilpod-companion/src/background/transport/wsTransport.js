/**
 * WebSocket transport — primary path to the PilPod desktop bridge.
 */

"use strict";

import { getBridgeConfig } from "../../shared/bridgeConfig.js";

export class WsTransport {
  /** @type {WebSocket|null} */
  #ws = null;

  /** @type {ReturnType<typeof setTimeout>|null} */
  #debounceTimer = null;

  /** @type {ReturnType<typeof setInterval>|null} */
  #heartbeatTimer = null;

  /** @type {ReturnType<typeof setTimeout>|null} */
  #reconnectTimer = null;

  /** @type {ReturnType<typeof setTimeout>|null} */
  #wakeTimer = null;

  /** @type {number} */
  #seq = 0;

  /** @type {number} */
  #failCount = 0;

  /** @type {boolean} */
  #sleeping = false;

  /** @type {boolean} */
  #stopped = false;

  /** @type {(() => void)|null} */
  #readyResolve = null;

  /** Pending until `#openSocket()` runs — must not use `Promise.reject` here (unhandled rejection). */
  #readyPromise = new Promise(() => {});

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

  waitForReady(timeoutMs) {
    const ms = timeoutMs ?? getBridgeConfig().wsConnectTimeoutMs;
    return Promise.race([
      this.#readyPromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("ws connect timeout")), ms);
      }),
    ]);
  }

  schedulePush() {
    const { debounceMs } = getBridgeConfig();
    if (this.#debounceTimer !== null) return;
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      this.#push();
    }, debounceMs);
  }

  startHeartbeat() {
    const { pushIntervalMs } = getBridgeConfig();
    if (this.#heartbeatTimer !== null) return;
    this.#heartbeatTimer = setInterval(() => this.#push(), pushIntervalMs);
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
    if (this.#wakeTimer !== null) {
      clearTimeout(this.#wakeTimer);
      this.#wakeTimer = null;
    }
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  #openSocket() {
    if (this.#sleeping) return;

    const { wsUrl } = getBridgeConfig();

    this.#readyPromise = new Promise((resolve) => {
      this.#readyResolve = resolve;
    });

    const ws = new WebSocket(wsUrl);
    this.#ws = ws;

    ws.onopen = () => {
      this.#failCount = 0;
      this.#sleeping = false;
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
      this.#onFailure();
      if (!this.#sleeping) {
        this.#scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose fires after onerror
    };
  }

  #scheduleReconnect() {
    const { wsReconnectMs } = getBridgeConfig();
    if (this.#stopped || this.#reconnectTimer !== null || this.#sleeping) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#openSocket();
    }, wsReconnectMs);
  }

  #onFailure() {
    const { failThreshold, sleepIntervalMs } = getBridgeConfig();
    this.#failCount++;
    if (this.#failCount >= failThreshold && !this.#sleeping) {
      this.#sleeping = true;
      if (this.#wakeTimer === null) {
        this.#wakeTimer = setTimeout(() => {
          this.#wakeTimer = null;
          this.#wakeAndRetry();
        }, sleepIntervalMs);
      }
    }
  }

  #wakeAndRetry() {
    this.#sleeping = false;
    this.#openSocket();
  }

  #push() {
    if (this.#sleeping) return;
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;

    const cfg = getBridgeConfig();
    const dirty = this.#registry.isDirty();
    const payload = dirty
      ? {
          type:            "sync",
          browserId:       this.#getBrowserId(),
          browserName:     this.#getBrowserName(),
          tabs:            this.#registry.all(),
          protocolVersion: cfg.protocolVersion,
        }
      : {
          type:            "ping",
          browserId:       this.#getBrowserId(),
          seq:             this.#seq++,
          protocolVersion: cfg.protocolVersion,
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
