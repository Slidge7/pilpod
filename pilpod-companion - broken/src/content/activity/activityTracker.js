/**
 * @file activityTracker.js
 * Tracks the last user-interaction time on the page.
 * Used to populate `userIdleMs` in the media snapshot sent to background.js.
 *
 * Listening at capture phase on a minimal event set ensures we catch
 * interactions even inside shadow DOM and cross-frame bubbles.
 */

"use strict";

const ACTIVITY_EVENTS = [
  "mousemove",
  "keydown",
  "scroll",
  "click",
  "touchstart",
  "pointerdown",
];

export class ActivityTracker {
  #lastActivityAt = Date.now();

  constructor() {
    const handler = () => { this.#lastActivityAt = Date.now(); };
    for (const evt of ACTIVITY_EVENTS) {
      document.addEventListener(evt, handler, { passive: true, capture: true });
    }
  }

  /** Milliseconds since the last user interaction. */
  get idleMs() {
    return Date.now() - this.#lastActivityAt;
  }
}