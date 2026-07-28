import { describe, it, expect } from "vitest";
import { gateDecision, isBrowserLocked, setupBadgeCount, shouldShowGate } from "../gate";
import type { ActivationState, BrowserSetupInfo, SetupOverview } from "../../types";

function browser(over: Partial<BrowserSetupInfo> = {}): BrowserSetupInfo {
  return {
    id: "chrome",
    displayName: "Google Chrome",
    engine: "chromium",
    storeSupport: "native",
    extensionsPage: "chrome://extensions",
    activationState: "inactive",
    launchable: true,
    running: true,
    extensionOnDisk: false,
    ...over,
  };
}

function overview(over: Partial<SetupOverview> = {}): SetupOverview {
  return {
    storeUrl: "https://chromewebstore.google.com/detail/abc",
    browsers: [browser()],
    onboardingDismissed: false,
    needsAttention: true,
    anyActive: false,
    ...over,
  };
}

describe("gateDecision", () => {
  it("shows for a fresh machine with an unconfigured browser", () => {
    expect(gateDecision(overview(), false)).toEqual({
      show: true,
      reason: "needsSetup",
    });
  });

  it("stays hidden while still loading", () => {
    // Otherwise the setup screen flashes before the browser list arrives.
    expect(gateDecision(overview(), true)).toEqual({ show: false, reason: "loading" });
  });

  it("never reappears once dismissed", () => {
    const d = gateDecision(overview({ onboardingDismissed: true }), false);
    expect(d).toEqual({ show: false, reason: "dismissed" });
  });

  it("stays hidden once any browser works", () => {
    const d = gateDecision(
      overview({
        anyActive: true,
        browsers: [
          browser({ id: "chrome", activationState: "active" }),
          browser({ id: "msedge", activationState: "inactive" }),
        ],
      }),
      false,
    );
    // A second browser is an opportunity, not a blocker — that lives in the
    // permanent section, not a first-run gate.
    expect(d).toEqual({ show: false, reason: "alreadyActive" });
  });

  it("stays hidden on a machine it cannot help", () => {
    const d = gateDecision(
      overview({
        browsers: [
          browser({ id: "firefox", engine: "gecko", storeSupport: "unsupported" }),
        ],
      }),
      false,
    );
    expect(d).toEqual({ show: false, reason: "nothingToSetUp" });
  });

  it("stays hidden when every browser was skipped", () => {
    const d = gateDecision(
      overview({ browsers: [browser({ activationState: "skipped" })] }),
      false,
    );
    expect(d.show).toBe(false);
    expect(d.reason).toBe("nothingToSetUp");
  });

  it("stays hidden with no browsers at all", () => {
    const d = gateDecision(overview({ browsers: [] }), false);
    expect(d).toEqual({ show: false, reason: "nothingToSetUp" });
  });

  it("shows again for a revoked browser that was never dismissed", () => {
    const d = gateDecision(
      overview({ browsers: [browser({ activationState: "revoked" })] }),
      false,
    );
    expect(d.show).toBe(true);
  });

  it("does not show mid-setup, since the guide is already open", () => {
    const d = gateDecision(
      overview({ browsers: [browser({ activationState: "setupPending" })] }),
      false,
    );
    expect(d.show).toBe(false);
  });

  it("prefers loading over every other reason", () => {
    const d = gateDecision(overview({ onboardingDismissed: true, anyActive: true }), true);
    expect(d.reason).toBe("loading");
  });

  it("prefers dismissed over active", () => {
    const d = gateDecision(overview({ onboardingDismissed: true, anyActive: true }), false);
    expect(d.reason).toBe("dismissed");
  });
});

describe("shouldShowGate", () => {
  it("agrees with gateDecision", () => {
    const cases: Array<[SetupOverview, boolean]> = [
      [overview(), false],
      [overview({ onboardingDismissed: true }), false],
      [overview({ anyActive: true }), false],
    ];
    for (const [ov, loading] of cases) {
      expect(shouldShowGate(ov, loading)).toBe(gateDecision(ov, loading).show);
    }
  });
});

describe("setupBadgeCount", () => {
  it("counts only actionable browsers", () => {
    const list = [
      browser({ id: "a", activationState: "inactive" }),
      browser({ id: "b", activationState: "revoked" }),
      browser({ id: "c", activationState: "active" }),
      browser({ id: "d", activationState: "skipped" }),
      browser({ id: "e", activationState: "setupPending" }),
      browser({ id: "f", storeSupport: "unsupported" }),
    ];
    expect(setupBadgeCount(list)).toBe(2);
  });

  it("is zero on a fully configured machine", () => {
    expect(setupBadgeCount([browser({ activationState: "active" })])).toBe(0);
  });

  it("is zero with no browsers", () => {
    expect(setupBadgeCount([])).toBe(0);
  });
});

describe("isBrowserLocked", () => {
  it("unlocks only verified browsers", () => {
    const states: ActivationState[] = [
      "inactive",
      "setupPending",
      "active",
      "revoked",
      "skipped",
    ];
    for (const s of states) {
      expect(isBrowserLocked(s)).toBe(s !== "active");
    }
  });

  it("treats an unknown state as locked", () => {
    // Fail closed: a payload from a newer backend must not unlock anything.
    expect(isBrowserLocked("somethingNew")).toBe(true);
  });
});
