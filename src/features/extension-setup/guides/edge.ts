import type { Guide } from "./types";

/**
 * Microsoft Edge override.
 *
 * Edge installs Chrome Web Store items, but only after the user accepts the
 * "Allow extensions from other stores" banner that appears at the top of the
 * listing. Without that step the Add button appears to do nothing at all — the
 * single most confusing failure in this whole flow, so it gets its own step
 * *before* the install rather than a footnote after it.
 */
export const EDGE_GUIDE: Guide = {
  id: "edge",
  intro:
    "PilPod needs its companion extension in {browser}. Edge can install it " +
    "from the Chrome Web Store once you allow other stores — one extra click, " +
    "and only the first time.",
  steps: [
    {
      id: "open-listing",
      title: "Open the PilPod Companion listing",
      body:
        "We'll open the Chrome Web Store in {browser} itself, so the extension " +
        "lands in the right browser.",
      action: { kind: "openStore", label: "Open in {browser}" },
    },
    {
      id: "allow-other-stores",
      title: 'Click "Allow extensions from other stores"',
      body:
        "Edge shows this as a blue banner across the top of the page, then asks " +
        'you to confirm with "Allow". If you skip it, the Add button will look ' +
        "like it isn't working.",
      action: { kind: "none" },
      diagram: "edgeAllowBanner",
    },
    {
      id: "add-extension",
      title: 'Click "Add to Chrome", then "Add extension"',
      body:
        "The button keeps its Chrome wording inside Edge — that's expected, and " +
        "it installs into {browser}.",
      action: { kind: "copyStoreUrl", label: "Copy link" },
      diagram: "storeAddButton",
    },
    {
      id: "verify",
      title: "Come back here",
      body:
        "PilPod detects the extension by itself, usually within a second or two " +
        "of it being added.",
      action: { kind: "none" },
      diagram: "verifyLive",
      live: true,
    },
  ],
};
