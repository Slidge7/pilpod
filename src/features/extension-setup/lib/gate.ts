/**
 * When to show the first-run onboarding gate — pure, no React.
 *
 * The policy is deliberately soft. A hard block would trap anyone whose browser
 * can't install the extension (Gecko, or a machine where corporate policy
 * blocks the store), and PilPod still does useful things without it. So the
 * gate is a first-run prompt the user can always dismiss, not a wall.
 */

import type { BrowserSetupInfo, SetupOverview } from "../types";
import { browsersNeedingAttention } from "./status";

export type GateDecision = {
  show: boolean;
  /** Why — for logging, tests, and choosing the heading. */
  reason:
    | "loading"
    | "dismissed"
    | "alreadyActive"
    | "nothingToSetUp"
    | "needsSetup";
};

/**
 * Decide whether the gate should appear.
 *
 * Order matters, and each rule exists because of a specific bad experience:
 *
 * 1. **Still loading** — never flash a setup screen before we know what's
 *    installed; the browser list arrives a beat after the window opens.
 * 2. **Dismissed** — the user said no. Asking again on the next launch is how
 *    onboarding becomes nagging.
 * 3. **Something already works** — if any browser is verified, the app is
 *    usable; a second browser is an opportunity, not a blocker. The permanent
 *    section is where that belongs.
 * 4. **Nothing we can help with** — a Firefox-only machine gets no gate,
 *    because there is no action it could offer.
 */
export function gateDecision(
  overview: SetupOverview,
  loading: boolean,
): GateDecision {
  if (loading) return { show: false, reason: "loading" };
  if (overview.onboardingDismissed) return { show: false, reason: "dismissed" };
  if (overview.anyActive) return { show: false, reason: "alreadyActive" };

  const actionable = browsersNeedingAttention(overview.browsers);
  if (actionable.length === 0) {
    return { show: false, reason: "nothingToSetUp" };
  }
  return { show: true, reason: "needsSetup" };
}

/** Convenience wrapper for components that only need the boolean. */
export function shouldShowGate(
  overview: SetupOverview,
  loading: boolean,
): boolean {
  return gateDecision(overview, loading).show;
}

/**
 * Badge count for the "Browser setup" menu entry: browsers the user could act
 * on right now. Zero means no badge.
 */
export function setupBadgeCount(browsers: BrowserSetupInfo[]): number {
  return browsersNeedingAttention(browsers).length;
}

/**
 * Whether a browser's dashboard row should be locked.
 *
 * One rule, one place: only a verified browser is unlocked. The in-app player
 * row reports itself as `active`, so it is never gated.
 */
export function isBrowserLocked(activationState: string): boolean {
  return activationState !== "active";
}
