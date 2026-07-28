/**
 * The guide content model.
 *
 * Instructions are *data*, not JSX. Adding a step, reordering steps, or
 * supporting a new browser never touches a component — which is the whole point:
 * the copy changes far more often than the rendering does, and copy changes
 * should not be able to break the live-verification wiring.
 *
 * Placeholders in `title`/`body` are interpolated at render time:
 *
 * - `{browser}`        display name, e.g. "Microsoft Edge"
 * - `{storeUrl}`       canonical Chrome Web Store listing URL
 * - `{extensionsPage}` the browser's own extensions page, e.g. "edge://extensions"
 */

/** What a step's button does. `none` renders the step with no button. */
export type StepActionKind =
  | "openStore"
  | "openExtensionsPage"
  | "copyStoreUrl"
  | "none";

export type StepAction = {
  kind: StepActionKind;
  /** Button text. Supports the same placeholders as step copy. */
  label?: string;
};

/** Inline SVG illustration keys. Resolved by `components/diagrams`. */
export type DiagramId =
  | "storeAddButton"
  | "edgeAllowBanner"
  | "operaAddon"
  | "verifyLive";

export type GuideStep = {
  /** Stable key — used for React keys and for progress tracking. */
  id: string;
  title: string;
  body: string;
  action: StepAction;
  diagram?: DiagramId;
  /**
   * This step reflects live activation state and completes on its own when the
   * bridge handshake lands. Exactly one step per guide should set this.
   */
  live?: boolean;
};

export type GuideId = "chromium" | "edge" | "opera" | "unsupported";

export type Guide = {
  id: GuideId;
  /** Shown above the steps. Supports placeholders. */
  intro: string;
  steps: GuideStep[];
};

/** Values available to placeholder interpolation. */
export type GuideVars = {
  browser: string;
  storeUrl: string;
  extensionsPage: string | null;
};
