import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  applyCapabilitiesForTests,
  getBridgeConfig,
  getValidatedWsUrl,
  isAllowedLocalhostUrl,
  resetBridgeConfigForTests,
} from "../bridgeConfig.js";
import { WS_URL } from "../constants.js";

describe("isAllowedLocalhostUrl", () => {
  it("accepts localhost http and ws", () => {
    expect(isAllowedLocalhostUrl("http://127.0.0.1:17399/browser-tabs")).toBe(true);
    expect(isAllowedLocalhostUrl("ws://127.0.0.1:17400/ws", { allowWs: true })).toBe(true);
  });

  it("rejects external hosts", () => {
    expect(isAllowedLocalhostUrl("ws://evil.com/ws", { allowWs: true })).toBe(false);
    expect(isAllowedLocalhostUrl("http://example.com/")).toBe(false);
  });
});

describe("loadBridgeConfig security", () => {
  beforeEach(() => {
    resetBridgeConfigForTests();
  });

  afterEach(() => {
    resetBridgeConfigForTests();
  });

  it("ignores spoofed external wsUrl from capabilities", () => {
    applyCapabilitiesForTests({ wsUrl: "ws://evil.com/ws" });
    expect(getBridgeConfig().wsUrl).toBe(WS_URL);
    expect(getValidatedWsUrl()).toBe(WS_URL);
  });

  it("accepts localhost wsUrl override", () => {
    applyCapabilitiesForTests({ wsUrl: "ws://127.0.0.1:17400/ws" });
    expect(getValidatedWsUrl()).toBe("ws://127.0.0.1:17400/ws");
  });
});
