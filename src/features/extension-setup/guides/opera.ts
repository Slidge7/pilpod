import type { Guide } from "./types";

/**
 * Opera / Opera GX override.
 *
 * Opera cannot install Chrome Web Store items out of the box. It needs the
 * "Install Chrome Extensions" add-on from Opera's own store first, which is a
 * genuinely different first step — not a banner like Edge's, but a separate
 * install with a browser restart in some builds.
 */
export const OPERA_GUIDE: Guide = {
  id: "opera",
  intro:
    "{browser} needs a small helper add-on before it can install Chrome Web " +
    "Store extensions. You only do this once.",
  steps: [
    {
      id: "install-helper",
      title: 'Install "Install Chrome Extensions" from the Opera add-ons site',
      body:
        "Search Opera's own add-ons site for “Install Chrome Extensions” and add " +
        "it. This is Opera's official bridge to the Chrome Web Store.",
      action: { kind: "none" },
      diagram: "operaAddon",
    },
    {
      id: "open-listing",
      title: "Open the PilPod Companion listing",
      body: "We'll open the Chrome Web Store in {browser} itself.",
      action: { kind: "openStore", label: "Open in {browser}" },
    },
    {
      id: "add-extension",
      title: 'Click "Add to Opera"',
      body:
        "With the helper installed, the store's install button becomes an Opera " +
        "one. Confirm the prompt to finish.",
      action: { kind: "copyStoreUrl", label: "Copy link" },
      diagram: "storeAddButton",
    },
    {
      id: "verify",
      title: "Come back here",
      body:
        "PilPod detects the extension by itself. If nothing happens, check the " +
        "helper add-on is enabled and try the listing again.",
      action: { kind: "none" },
      diagram: "verifyLive",
      live: true,
    },
  ],
};
