/**
 * Message types, command names, and wire-format types for the Rust ↔ extension contract.
 */

"use strict";

// ─── Message types (background ↔ content) ────────────────────────────────────

export const MSG_MEDIA_SNAPSHOT = "PILPOD_MEDIA_SNAPSHOT";
export const MSG_MEDIA_CONTROL  = "PILPOD_MEDIA_CONTROL";

// ─── Commands (Rust → background → tab) ────────────────────────────────────────

/** @enum {string} */
export const Command = Object.freeze({
  FOCUS_TAB:      "focusTab",
  REACTIVATE_TAB: "reactivateTab",
  RELOAD_TAB:     "reloadTab",
  CLOSE_TAB:      "closeTab",
  PLAY_PAUSE:     "playPause",
  NEXT:           "next",
  PREVIOUS:       "previous",
});

// ─── Tab states (extension → Rust) ───────────────────────────────────────────

/** @enum {string} */
export const TabState = Object.freeze({
  ACTIVE:   "active",
  INACTIVE: "inactive",
  LOADING:  "loading",
  SLEEPING: "sleeping",
  CRASHED:  "crashed",
  UNKNOWN:  "unknown",
});

// ─── JSDoc wire types ────────────────────────────────────────────────────────

/**
 * @typedef {object} MediaSnapshot
 * @property {string}  playbackState
 * @property {string}  title
 * @property {string}  artist
 * @property {string}  album
 * @property {string}  artworkUrl
 * @property {number}  duration
 * @property {number}  currentTime
 * @property {boolean} pageVisible
 * @property {number}  userIdleMs
 * @property {string}  documentState
 */

/**
 * @typedef {object} TabPost
 * @property {number} tabId
 * @property {number} windowId
 * @property {string} url
 * @property {string} title
 * @property {string} favIconUrl
 * @property {string} tabState
 * @property {boolean} active
 * @property {boolean} windowFocused
 * @property {boolean} audible
 * @property {boolean} muted
 * @property {boolean} pinned
 * @property {number} index
 * @property {MediaSnapshot|null} media
 */

/**
 * Full sync or lightweight ping payload sent to the desktop bridge.
 * @typedef {object} BrowserPayload
 * @property {string} browserId
 * @property {string} [browserName]
 * @property {TabPost[]} [tabs]
 * @property {boolean} [ping]
 * @property {number} [seq]
 * @property {string} [protocolVersion]
 */

/**
 * @typedef {object} DesktopCommand
 * @property {number} tabId
 * @property {string} action
 */

/**
 * @typedef {object} DesktopResponse
 * @property {DesktopCommand[]} commands
 */
