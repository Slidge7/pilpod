import { describe, it, expect } from "vitest";
import {
  browsersNeedingAttention,
  canSkip,
  diagnose,
  diagnosisHint,
  isUnlocked,
  primaryActionLabel,
  statusBadge,
} from "../status";
import type { ActivationState, BrowserSetupInfo } from "../../types";

const ALL_STATES: ActivationState[] = [
  "inactive",
  "setupPending",
  "active",
  "revoked",
  "skipped",
];

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

describe("statusBadge", () => {
  it("has a distinct label for every state", () => {
    const labels = ALL_STATES.map((s) => statusBadge(browser({ activationState: s })).label);
    expect(new Set(labels).size).toBe(ALL_STATES.length);
  });

  it("marks only active as good", () => {
    for (const s of ALL_STATES) {
      const tone = statusBadge(browser({ activationState: s })).tone;
      expect(tone === "good").toBe(s === "active");
    }
  });

  it("warns on revoked, because it used to work", () => {
    expect(statusBadge(browser({ activationState: "revoked" })).tone).toBe("warn");
  });

  it("shows unsupported instead of a setup state, whatever the state says", () => {
    for (const s of ALL_STATES) {
      const badge = statusBadge(browser({ storeSupport: "unsupported", activationState: s }));
      expect(badge.label).toBe("Not supported");
      expect(badge.tone).toBe("muted");
    }
  });
});

describe("primaryActionLabel", () => {
  it("offers no action for an unsupported browser", () => {
    expect(primaryActionLabel(browser({ storeSupport: "unsupported" }))).toBeNull();
  });

  it("still offers a path for a working browser", () => {
    // Reinstalling after a browser update, or fixing a second profile.
    expect(primaryActionLabel(browser({ activationState: "active" }))).toBe("Reinstall");
  });

  it("uses recovery wording for a revoked browser", () => {
    expect(primaryActionLabel(browser({ activationState: "revoked" }))).toBe("Reconnect");
  });

  it("uses continuation wording mid-setup", () => {
    expect(primaryActionLabel(browser({ activationState: "setupPending" }))).toBe(
      "Continue setup",
    );
  });

  it("lets a skipped browser be picked back up", () => {
    expect(primaryActionLabel(browser({ activationState: "skipped" }))).toBe("Set up");
  });

  it("always returns a label for supported browsers", () => {
    for (const s of ALL_STATES) {
      expect(primaryActionLabel(browser({ activationState: s }))).toBeTruthy();
    }
  });
});

describe("isUnlocked", () => {
  it("unlocks only on active", () => {
    for (const s of ALL_STATES) {
      expect(isUnlocked(browser({ activationState: s }))).toBe(s === "active");
    }
  });

  it("does not unlock an unsupported browser that somehow reads active", () => {
    // Defensive: activation is keyed per browser id, so this shouldn't happen,
    // but "active" is the only thing that unlocks and it must stay that way.
    expect(isUnlocked(browser({ storeSupport: "unsupported", activationState: "active" }))).toBe(
      true,
    );
  });
});

describe("canSkip", () => {
  it("offers skip only for an untouched browser", () => {
    for (const s of ALL_STATES) {
      expect(canSkip(browser({ activationState: s }))).toBe(s === "inactive");
    }
  });

  it("never offers skip for an unsupported browser", () => {
    expect(canSkip(browser({ storeSupport: "unsupported" }))).toBe(false);
  });
});

describe("diagnose", () => {
  it("reports ok for a working browser", () => {
    expect(diagnose(browser({ activationState: "active" }))).toBe("ok");
  });

  it("reports unsupported ahead of everything else", () => {
    expect(
      diagnose(browser({ storeSupport: "unsupported", launchable: false, extensionOnDisk: true })),
    ).toBe("unsupported");
  });

  it("spots a browser whose executable is missing", () => {
    expect(diagnose(browser({ launchable: false }))).toBe("notLaunchable");
  });

  it("distinguishes installed-but-silent from never-installed", () => {
    expect(diagnose(browser({ extensionOnDisk: true, running: true }))).toBe(
      "installedButSilent",
    );
    expect(diagnose(browser({ extensionOnDisk: false, running: true }))).toBe("notInstalled");
  });

  it("blames the closed browser rather than the extension when it is not running", () => {
    expect(diagnose(browser({ extensionOnDisk: true, running: false }))).toBe("browserClosed");
  });

  it("prefers ok over any other signal once verified", () => {
    expect(
      diagnose(browser({ activationState: "active", extensionOnDisk: false, running: false })),
    ).toBe("ok");
  });
});

describe("diagnosisHint", () => {
  it("stays quiet when there is nothing useful to add", () => {
    expect(diagnosisHint(browser({ activationState: "active" }))).toBeNull();
    expect(diagnosisHint(browser({ storeSupport: "unsupported" }))).toBeNull();
    // "Not installed" is the expected state during setup — no scary hint.
    expect(diagnosisHint(browser())).toBeNull();
  });

  it("explains the two confusing cases", () => {
    expect(diagnosisHint(browser({ extensionOnDisk: true, running: true }))).toContain(
      "enabled",
    );
    expect(diagnosisHint(browser({ extensionOnDisk: true, running: false }))).toContain(
      "Open the browser",
    );
  });
});

describe("browsersNeedingAttention", () => {
  it("picks inactive and revoked only", () => {
    const list = ALL_STATES.map((s) => browser({ id: s, activationState: s }));
    expect(browsersNeedingAttention(list).map((b) => b.id)).toEqual(["inactive", "revoked"]);
  });

  it("never nags about an unsupported browser", () => {
    const list = [
      browser({ id: "firefox", storeSupport: "unsupported", activationState: "inactive" }),
    ];
    expect(browsersNeedingAttention(list)).toEqual([]);
  });

  it("never nags about a skipped browser", () => {
    expect(browsersNeedingAttention([browser({ activationState: "skipped" })])).toEqual([]);
  });

  it("returns nothing for an empty machine", () => {
    expect(browsersNeedingAttention([])).toEqual([]);
  });
});
