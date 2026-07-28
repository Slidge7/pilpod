import { describe, expect, it } from "vitest";
import type { DetectedBrowser } from "../../../../types/media";
import {
  actionEntry,
  appendLog,
  diffBrowsersPayload,
  LOG_MAX,
  type DevLogEntry,
} from "../eventLog";

function browser(overrides: Partial<DetectedBrowser> = {}): DetectedBrowser {
  return {
    id: "uuid-1",
    osBrowserId: "chrome",
    displayName: "Google Chrome",
    profileLabel: null,
    running: true,
    extensionInstalled: true,
    activationState: "active",
    extensionConnected: true,
    tabCount: 3,
    tabs: [],
    lastSyncSecs: 0,
    extensionReconnecting: false,
    iconUrl: null,
    ...overrides,
  };
}

describe("diffBrowsersPayload", () => {
  it("emits a single snapshot entry for the first payload", () => {
    const out = diffBrowsersPayload(null, [browser(), browser({ id: "u2" })]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("snapshot");
    expect(out[0].message).toContain("2");
  });

  it("returns nothing when nothing changed", () => {
    expect(diffBrowsersPayload([browser()], [browser()])).toHaveLength(0);
  });

  it("detects added and removed rows", () => {
    const a = browser();
    const b = browser({ id: "uuid-2", displayName: "Brave" });
    const added = diffBrowsersPayload([a], [a, b]);
    expect(added).toHaveLength(1);
    expect(added[0].kind).toBe("browser-added");
    expect(added[0].subject).toBe("Brave");

    const removed = diffBrowsersPayload([a, b], [a]);
    expect(removed).toHaveLength(1);
    expect(removed[0].kind).toBe("browser-removed");
  });

  it("detects connect and disconnect transitions", () => {
    const off = browser({ extensionConnected: false });
    const on = browser({ extensionConnected: true });
    expect(diffBrowsersPayload([off], [on])[0].kind).toBe("connected");
    expect(diffBrowsersPayload([on], [off])[0].kind).toBe("disconnected");
  });

  it("detects reconnecting, running, installed, and tab-count changes", () => {
    const base = browser();
    const rec = diffBrowsersPayload(
      [base],
      [browser({ extensionReconnecting: true })],
    );
    expect(rec[0].kind).toBe("reconnecting");

    const stopped = diffBrowsersPayload([base], [browser({ running: false })]);
    expect(stopped[0].kind).toBe("stopped");

    const cleared = diffBrowsersPayload(
      [base],
      [browser({ extensionInstalled: false })],
    );
    expect(cleared[0].kind).toBe("installed");

    const tabs = diffBrowsersPayload([base], [browser({ tabCount: 5 })]);
    expect(tabs[0].kind).toBe("tabs");
    expect(tabs[0].message).toBe("tabs 3 → 5");
  });

  it("treats missing extensionReconnecting as false (no phantom entry)", () => {
    const a = browser({ extensionReconnecting: undefined });
    const b = browser({ extensionReconnecting: false });
    expect(diffBrowsersPayload([a], [b])).toHaveLength(0);
  });

  it("uses the profile label as subject when present", () => {
    const off = browser({
      extensionConnected: false,
      profileLabel: "Chrome · Profile A",
    });
    const on = browser({
      extensionConnected: true,
      profileLabel: "Chrome · Profile A",
    });
    expect(diffBrowsersPayload([off], [on])[0].subject).toBe(
      "Chrome · Profile A",
    );
  });

  it("reports several changes on the same row at once", () => {
    const before = browser({ extensionConnected: false, tabCount: 1 });
    const after = browser({ extensionConnected: true, tabCount: 4 });
    const kinds = diffBrowsersPayload([before], [after]).map((e) => e.kind);
    expect(kinds).toContain("connected");
    expect(kinds).toContain("tabs");
  });
});

describe("appendLog", () => {
  it("prepends newest first and preserves order within a batch", () => {
    const log: DevLogEntry[] = [actionEntry("old", "old entry")];
    const batch = [actionEntry("a", "first"), actionEntry("b", "second")];
    const out = appendLog(log, batch);
    expect(out.map((e) => e.subject)).toEqual(["b", "a", "old"]);
  });

  it("returns the same array when the batch is empty", () => {
    const log: DevLogEntry[] = [actionEntry("x", "y")];
    expect(appendLog(log, [])).toBe(log);
  });

  it("trims to the cap", () => {
    let log: DevLogEntry[] = [];
    for (let i = 0; i < LOG_MAX + 50; i++) {
      log = appendLog(log, [actionEntry(`s${i}`, "m")]);
    }
    expect(log).toHaveLength(LOG_MAX);
    expect(log[0].subject).toBe(`s${LOG_MAX + 49}`); // newest kept
  });

  it("actionEntry flags errors", () => {
    expect(actionEntry("x", "boom", true).kind).toBe("error");
  });
});
