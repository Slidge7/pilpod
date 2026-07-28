/**
 * Guide resolution and placeholder interpolation — pure, no React.
 *
 * Resolution order, most specific first:
 *   1. `storeSupport === "unsupported"` → the dead-end guide, whatever the id
 *   2. a per-browser override (Edge, Opera)
 *   3. the engine default (Chromium)
 *   4. the dead-end guide
 *
 * Step 1 comes before the override lookup on purpose: capability beats
 * identity. If Edge ever stopped accepting Chrome Web Store items, flipping one
 * value in the Rust engine table would correctly route Edge users to the
 * "can't do this" screen without editing any guide.
 */

import type { BrowserSetupInfo } from "../types";
import { CHROMIUM_GUIDE } from "./chromium";
import { EDGE_GUIDE } from "./edge";
import { OPERA_GUIDE } from "./opera";
import type { Guide, GuideStep, GuideVars } from "./types";
import { UNSUPPORTED_GUIDE } from "./unsupported";

export * from "./types";
export { CHROMIUM_GUIDE, EDGE_GUIDE, OPERA_GUIDE, UNSUPPORTED_GUIDE };

/** Per-browser overrides, keyed by OS browser id. */
const BY_BROWSER_ID: Record<string, Guide> = {
  msedge: EDGE_GUIDE,
  opera: OPERA_GUIDE,
  operagx: OPERA_GUIDE,
};

/** Engine defaults for browsers with no override. */
const BY_ENGINE: Record<string, Guide> = {
  chromium: CHROMIUM_GUIDE,
};

/** Pick the guide for a browser. Never returns undefined. */
export function guideFor(
  browser: Pick<BrowserSetupInfo, "id" | "engine" | "storeSupport">,
): Guide {
  if (browser.storeSupport === "unsupported") return UNSUPPORTED_GUIDE;
  return (
    BY_BROWSER_ID[browser.id] ?? BY_ENGINE[browser.engine] ?? UNSUPPORTED_GUIDE
  );
}

/** Build the interpolation variables for a browser. */
export function varsFor(browser: BrowserSetupInfo, storeUrl: string): GuideVars {
  return {
    browser: browser.displayName,
    storeUrl,
    extensionsPage: browser.extensionsPage,
  };
}

const PLACEHOLDER = /\{(browser|storeUrl|extensionsPage)\}/g;

/**
 * Replace `{browser}` / `{storeUrl}` / `{extensionsPage}` in `text`.
 *
 * An unknown or null-valued placeholder is left verbatim rather than becoming
 * "null" or an empty gap — a visible `{extensionsPage}` in the UI is an obvious
 * bug report, whereas a silent blank reads as sloppy copy.
 */
export function interpolate(text: string, vars: GuideVars): string {
  return text.replace(PLACEHOLDER, (match, key: keyof GuideVars) => {
    const value = vars[key];
    return typeof value === "string" && value.length > 0 ? value : match;
  });
}

/** Interpolate every user-visible string on a step. */
export function resolveStep(step: GuideStep, vars: GuideVars): GuideStep {
  return {
    ...step,
    title: interpolate(step.title, vars),
    body: interpolate(step.body, vars),
    action: step.action.label
      ? { ...step.action, label: interpolate(step.action.label, vars) }
      : step.action,
  };
}

/** Interpolate a whole guide, ready to render. */
export function resolveGuide(guide: Guide, vars: GuideVars): Guide {
  return {
    ...guide,
    intro: interpolate(guide.intro, vars),
    steps: guide.steps.map((s) => resolveStep(s, vars)),
  };
}

/** Every guide, for exhaustive tests and for the dev-lab preview. */
export const ALL_GUIDES: Guide[] = [
  CHROMIUM_GUIDE,
  EDGE_GUIDE,
  OPERA_GUIDE,
  UNSUPPORTED_GUIDE,
];
