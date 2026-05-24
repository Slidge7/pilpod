/**
 * Single source of truth for "should this tab be reported as media?"
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
export function shouldReportMedia({ url, tabActive, tabAudible, snapshot }) {
  if (!isMediaUrl(url)) {
    return { pass: false, reason: "url-not-allowlisted" };
  }

  const state = String(snapshot?.playbackState ?? "").toLowerCase();
  if (state !== "playing") {
    return { pass: false, reason: "not-playing" };
  }

  if (tabActive !== true && tabAudible !== true) {
    return { pass: false, reason: "tab-not-active" };
  }

  return { pass: true, reason: "all-gates-passed" };
}
