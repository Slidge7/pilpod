import type { Guide } from "./types";

/**
 * Shown for Gecko browsers (Firefox, LibreWolf, Waterfox, Tor) and for any
 * browser we don't recognise.
 *
 * It is a dead end by design, and says so plainly. The failure mode worth
 * avoiding is a guide that walks someone through three steps toward a button
 * that cannot work — better to be honest in one screen and point them at a
 * browser that does work.
 */
export const UNSUPPORTED_GUIDE: Guide = {
  id: "unsupported",
  intro:
    "{browser} can't use the PilPod companion yet. The extension is published " +
    "on the Chrome Web Store, which only Chromium-based browsers can install " +
    "from.",
  steps: [
    {
      id: "use-another-browser",
      title: "Use a Chromium browser for now",
      body:
        "Chrome, Edge, Brave, Vivaldi and Opera all work. PilPod will keep " +
        "showing {browser} in the dashboard, but it can't read its tabs or " +
        "control playback there.",
      action: { kind: "none" },
    },
  ],
};
