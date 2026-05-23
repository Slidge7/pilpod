import type { DetectedBrowser } from "../../../types/media";

/** Deep-equal guard for browser list updates — avoids redundant React re-renders. */
export function browsersEqual(
  a: DetectedBrowser[],
  b: DetectedBrowser[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
