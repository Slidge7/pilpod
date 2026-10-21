import type { Guide } from "./types";

/**
 * The companion is already installed and enabled, it just isn't connected.
 *
 * The desktop connection is off by default in the extension and needs the
 * user's consent, so the fix is never the store — it's the companion's own
 * settings page, opened in the profile it's installed in.
 */
export const CONNECT_GUIDE: Guide = {
  id: "connect",
  intro:
    "PilPod Companion is already installed in {browser} — it just needs to be " +
    "connected to PilPod. One click on its settings page.",
  steps: [
    {
      id: "open-settings",
      title: "Open PilPod Companion settings",
      body:
        "We'll open the companion's settings page in {browser}, in the profile " +
        "it's installed in.",
      action: { kind: "connect", label: "Open settings in {browser}" },
    },
    {
      id: "press-connect",
      title: 'Click "Connect" and confirm',
      body:
        "The companion asks once before talking to PilPod. The connection never " +
        "leaves this computer.",
      action: { kind: "none" },
    },
    {
      id: "verify",
      title: "Come back here",
      body: "PilPod notices the connection by itself, usually within a second.",
      action: { kind: "none" },
      diagram: "verifyLive",
      live: true,
    },
  ],
};

/** Installed but switched off in the browser: turn it on first. */
export const ENABLE_GUIDE: Guide = {
  id: "enable",
  intro:
    "PilPod Companion is installed in {browser} but switched off. Turn it back " +
    "on and PilPod takes you through the rest.",
  steps: [
    {
      id: "open-extensions",
      title: "Open the companion on {extensionsPage}",
      body: "We'll open {browser}'s extensions page straight to PilPod Companion.",
      action: { kind: "connect", label: "Open in {browser}" },
    },
    {
      id: "switch-on",
      title: "Turn the toggle on",
      body:
        "As soon as it's on, PilPod opens the companion's settings for you so you " +
        "can connect it.",
      action: { kind: "none" },
    },
    {
      id: "verify",
      title: "Come back here",
      body: "PilPod notices the connection by itself, usually within a second.",
      action: { kind: "none" },
      diagram: "verifyLive",
      live: true,
    },
  ],
};
