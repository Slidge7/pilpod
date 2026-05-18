/**
 * Tracks last user interaction for userIdleMs in media snapshots.
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

  get idleMs() {
    return Date.now() - this.#lastActivityAt;
  }
}
