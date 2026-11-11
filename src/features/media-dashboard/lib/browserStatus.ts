import type { DetectedBrowser } from "../../../types/media";
import { isBrowserLocked } from "../../extension-setup";

/**
 * What a browser row's connection indicator says.
 *
 * Shared by every surface that lists browsers (the dashboard and Sky),
 * so "is this browser connected?" has exactly one answer in the app.
 */
export type BrowserConnectionStatus =
  "closed" | "connected" | "offline" | "reconnecting" | "no-ext";

/** The label a browser row is shown under: its profile, else the browser name. */
export function browserDisplayLabel(browser: DetectedBrowser): string {
  return browser.profileLabel ?? browser.displayName;
}

/** Format an age in seconds as a compact human-readable string. */
export function formatAge(secs: number): string {
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export function resolveBrowserStatus(
  browser: DetectedBrowser,
): BrowserConnectionStatus {
  if (!browser.running) return "closed";
  // Gated on verified activation rather than the old `extensionInstalled`
  // boolean, so a browser whose extension was removed or disabled (`revoked`)
  // reverts to the same "needs setup" treatment as one that never had it.
  if (isBrowserLocked(browser.activationState)) return "no-ext";
  if (browser.extensionReconnecting === true && !browser.extensionConnected) {
    return "reconnecting";
  }
  if (!browser.extensionConnected) return "offline";
  return "connected";
}
