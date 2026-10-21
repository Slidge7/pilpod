/**
 * Presentation logic for activation state — pure, no React.
 *
 * Everything the UI needs to decide *what to say* about a browser lives here so
 * it can be tested without rendering: badge copy, button copy, whether the row
 * is actionable, and the diagnosis when something looks wrong.
 */

import type { ActivationState, BrowserSetupInfo, InstallState } from "../types";

/** Install state, falling back to the coarse on-disk flag for old payloads. */
export function installStateOf(browser: BrowserSetupInfo): InstallState {
  return browser.installState ?? (browser.extensionOnDisk ? "installed" : "notInstalled");
}

export type StatusTone = "neutral" | "pending" | "good" | "warn" | "muted";

export type StatusBadge = {
  label: string;
  tone: StatusTone;
};

const BADGES: Record<ActivationState, StatusBadge> = {
  inactive: { label: "Not connected", tone: "neutral" },
  setupPending: { label: "Waiting for install…", tone: "pending" },
  active: { label: "Connected", tone: "good" },
  revoked: { label: "Disconnected", tone: "warn" },
  skipped: { label: "Skipped", tone: "muted" },
};

const UNSUPPORTED_BADGE: StatusBadge = {
  label: "Not supported",
  tone: "muted",
};

const INSTALLED_NOT_CONNECTED: StatusBadge = {
  label: "Installed · not connected",
  tone: "pending",
};

const INSTALLED_DISABLED: StatusBadge = {
  label: "Installed · turned off",
  tone: "warn",
};

/** Badge for a browser row. Unsupported browsers never show a setup state. */
export function statusBadge(browser: BrowserSetupInfo): StatusBadge {
  if (browser.storeSupport === "unsupported") return UNSUPPORTED_BADGE;
  const s = browser.activationState;
  // Not connected yet, but we know the extension is there: say so, rather than
  // the generic "Not connected" that reads as "go install it".
  if (s === "inactive" || s === "setupPending" || s === "revoked") {
    const install = installStateOf(browser);
    if (install === "disabled") return INSTALLED_DISABLED;
    if (install === "installed") return INSTALLED_NOT_CONNECTED;
  }
  return BADGES[s] ?? BADGES.inactive;
}

/**
 * Label for the row's primary button, or `null` when the row has no action.
 *
 * `active` still offers an action ("Reinstall") because the commonest reason to
 * open the guide for a working browser is to fix a *different* profile or to
 * reinstall after an update — refusing to show it would be a dead end.
 */
export function primaryActionLabel(browser: BrowserSetupInfo): string | null {
  if (browser.storeSupport === "unsupported") return null;
  const install = installStateOf(browser);
  if (browser.activationState === "active") {
    // Installed and working: the useful thing is its settings, not the store.
    return install === "notInstalled" ? "Reinstall" : "Settings";
  }
  // The button does whatever gets this browser connected (see
  // `extension_setup_connect`), so name what it will actually do.
  if (install === "disabled") return "Turn on";
  if (install === "installed") return "Connect";
  switch (browser.activationState) {
    case "revoked":
      return "Reconnect";
    case "setupPending":
      return "Continue setup";
    case "skipped":
      return "Set up";
    case "inactive":
    default:
      return "Set up";
  }
}

/** Can this browser's features be used? Only verification unlocks them. */
export function isUnlocked(browser: BrowserSetupInfo): boolean {
  return browser.activationState === "active";
}

/** Should this row offer "Skip for now"? Only when it hasn't been dealt with. */
export function canSkip(browser: BrowserSetupInfo): boolean {
  if (browser.storeSupport === "unsupported") return false;
  return browser.activationState === "inactive";
}

export type Diagnosis =
  | "ok"
  | "unsupported"
  | "notLaunchable"
  | "installedDisabled"
  | "installedButSilent"
  | "browserClosed"
  | "notInstalled";

/**
 * Best guess at *why* a browser isn't working, so the UI can give advice that
 * fits instead of one generic "something went wrong".
 *
 * Order matters: each check assumes the ones above it have been ruled out.
 */
export function diagnose(browser: BrowserSetupInfo): Diagnosis {
  if (browser.storeSupport === "unsupported") return "unsupported";
  if (browser.activationState === "active") return "ok";
  // Detected (registry) but we can't find the exe — a broken/partial install.
  if (!browser.launchable) return "notLaunchable";
  const install = installStateOf(browser);
  // Installed but switched off in the browser — nothing can connect until it's on.
  if (install === "disabled") return "installedDisabled";
  // Installed and on, but not connected: almost always the desktop connection
  // hasn't been turned on in the companion's settings yet (it is off by default).
  if (install === "installed") {
    return browser.running ? "installedButSilent" : "browserClosed";
  }
  return "notInstalled";
}

const DIAGNOSIS_HINTS: Record<Diagnosis, string | null> = {
  ok: null,
  unsupported: null,
  notLaunchable:
    "PilPod can see this browser is installed but can't find its program file. " +
    "Reinstalling the browser usually fixes this.",
  installedDisabled:
    "The companion is installed here but turned off. Press Turn on to open the " +
    "extensions page and switch it on.",
  installedButSilent:
    "The companion is installed and enabled here, but not connected to PilPod " +
    "yet. Press Connect to open its settings, then click Connect there.",
  browserClosed:
    "The companion is installed here. Open the browser — if it doesn't connect " +
    "by itself, press Connect.",
  notInstalled: null,
};

/** One-line explanation for a diagnosis, or `null` when none is warranted. */
export function diagnosisHint(browser: BrowserSetupInfo): string | null {
  return DIAGNOSIS_HINTS[diagnose(browser)];
}

/**
 * Browsers worth prompting about. Mirrors the Rust `needs_attention` rule so
 * the badge on the menu entry agrees with the gate.
 */
export function browsersNeedingAttention(
  browsers: BrowserSetupInfo[],
): BrowserSetupInfo[] {
  return browsers.filter(
    (b) =>
      b.storeSupport !== "unsupported" &&
      (b.activationState === "inactive" || b.activationState === "revoked"),
  );
}
