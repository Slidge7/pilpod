/**
 * @file protocol.js
 * Shared message types, action names, and JSDoc type definitions used by both
 * the background service worker and the content script.
 *
 * Keeping these in one place means any rename ripples out from a single diff,
 * making the Rust ↔ extension contract explicit and easy to audit.
 */

"use strict";

// ─── Message Types (background ↔ content script) ─────────────────────────────

/** Content script → background: periodic media snapshot. */
export const MSG_MEDIA_SNAPSHOT = "PILPOD_MEDIA_SNAPSHOT";

/** Background → content script: execute a playback command. */
export const MSG_MEDIA_CONTROL  = "PILPOD_MEDIA_CONTROL";

// ─── Command Names (Rust desktop app → background → tab) ─────────────────────

/** @enum {string} */
export const Command = Object.freeze({
  // Tab management — work on any tab.
  FOCUS_TAB:      "focusTab",
  REACTIVATE_TAB: "reactivateTab",
  RELOAD_TAB:     "reloadTab",
  CLOSE_TAB:      "closeTab",

  // Media control — forwarded to content script; tab must have active media.
  PLAY_PAUSE: "playPause",
  NEXT:       "next",
  PREVIOUS:   "previous",
});

// ─── Tab States (sent to Rust) ────────────────────────────────────────────────

/** @enum {string} */
export const TabState = Object.freeze({
  ACTIVE:   "active",
  INACTIVE: "inactive",
  LOADING:  "loading",
  SLEEPING: "sleeping",
  CRASHED:  "crashed",
  UNKNOWN:  "unknown",
});

// ─── JSDoc Type Definitions ───────────────────────────────────────────────────

/**
 * @typedef {object} MediaSnapshot
 * @property {string}  playbackState  - "playing" | "paused" | "none"
 * @property {string}  title
 * @property {string}  artist
 * @property {string}  album
 * @property {string}  artworkUrl
 * @property {number}  duration       - seconds
 * @property {number}  currentTime    - seconds
 * @property {boolean} pageVisible
 * @property {number}  userIdleMs
 * @property {string}  documentState  - "loading" | "interactive" | "complete"
 */

/**
 * @typedef {object} TabPost
 * @property {number}         tabId
 * @property {number}         windowId
 * @property {string}         url
 * @property {string}         title
 * @property {string}         favIconUrl
 * @property {string}         tabState    - one of TabState values
 * @property {boolean}        active
 * @property {boolean}        windowFocused
 * @property {boolean}        audible
 * @property {boolean}        muted
 * @property {boolean}        pinned
 * @property {number}         index
 * @property {MediaSnapshot|null} media
 */

/**
 * @typedef {object} BrowserPayload
 * @property {string}    browserId
 * @property {string}    browserName
 * @property {TabPost[]} tabs
 */

/**
 * @typedef {object} DesktopCommand
 * @property {number} tabId
 * @property {string} action  - one of Command values
 */

/**
 * @typedef {object} DesktopResponse
 * @property {DesktopCommand[]} commands
 */