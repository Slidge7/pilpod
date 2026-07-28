import type { Guide } from "./types";

/**
 * Default walkthrough for Chromium browsers that install from the Chrome Web
 * Store without any opt-in: Chrome, Brave, Vivaldi, Chromium, Arc, Yandex.
 *
 * Three steps, because the listing is unlisted rather than side-loaded — there
 * is no Developer Mode, no unpacked folder, and nothing to unzip.
 */
export const CHROMIUM_GUIDE: Guide = {
  id: "chromium",
  intro:
    "PilPod needs its companion extension in {browser} to see tabs and control " +
    "playback. It takes about thirty seconds.",
  steps: [
    {
      id: "open-listing",
      title: "Open the PilPod Companion listing",
      body:
        "We'll open the Chrome Web Store in {browser} itself — not your default " +
        "browser — so the extension lands in the right place.",
      action: { kind: "openStore", label: "Open in {browser}" },
    },
    {
      id: "add-extension",
      title: 'Click "Add to {browser}"',
      body:
        "Confirm the permission prompt when it appears. The listing is unlisted, " +
        "so it won't show up in store search — this link is the way in.",
      action: { kind: "copyStoreUrl", label: "Copy link" },
      diagram: "storeAddButton",
    },
    {
      id: "verify",
      title: "Come back here",
      body:
        "That's it — PilPod detects the extension by itself, usually within a " +
        "second or two of it being added.",
      action: { kind: "none" },
      diagram: "verifyLive",
      live: true,
    },
  ],
};
