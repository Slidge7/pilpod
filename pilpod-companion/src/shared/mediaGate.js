/**
 * Single source of truth for "should this tab be reported as media?"
 * Allowlisted URLs always carry a media snapshot (any playback/tab state).
 * Pure JS — no browser APIs.
 */

"use strict";

import { isMediaUrl } from "./mediaUrlRules.js";

/**
 * @param {object} opts
 * @param {string}  opts.url
 * @param {boolean} opts.tabActive
 * @param {boolean} opts.tabAudible
 * @param {object}  opts.snapshot
 * @param {string}  [opts.snapshot.playbackState]
 * @returns {{ pass: boolean, reason: string }}
 */
export function shouldReportMedia({ url }) {
  if (!isMediaUrl(url)) {
    return { pass: false, reason: "url-not-allowlisted" };
  }

  return { pass: true, reason: "url-allowlisted" };
}
