/**
 * Mirrors the Rust DTOs in `src-tauri/src/extension_setup/service.rs`.
 * Keep the two in sync — the field names here are the serde camelCase output.
 */

import type { ActivationState } from "../../types/media";

export type { ActivationState };

/** Mirrors `extension_setup::engine::EngineFamily`. */
export type EngineFamily = "chromium" | "gecko";

/**
 * Mirrors `extension_setup::engine::StoreSupport`.
 *
 * - `native`      — one click from the listing
 * - `needsOptIn`  — works only after a one-time browser setting or helper add-on
 * - `unsupported` — cannot install a Chrome Web Store item at all
 */
export type StoreSupport = "native" | "needsOptIn" | "unsupported";

/** One browser row in the setup screen. */
export type BrowserSetupInfo = {
  id: string;
  displayName: string;
  engine: EngineFamily;
  storeSupport: StoreSupport;
  extensionsPage: string | null;
  activationState: ActivationState;
  /** We can resolve its executable, so "Open in <Browser>" will work. */
  launchable: boolean;
  running: boolean;
  /** Companion files found in one of its profiles, even if it never connected. */
  extensionOnDisk: boolean;
  iconUrl?: string | null;
  firstActivatedAt?: number;
  lastVerifiedAt?: number;
};

/** Everything the setup screen needs, from one `extension_setup_overview` call. */
export type SetupOverview = {
  storeUrl: string;
  browsers: BrowserSetupInfo[];
  onboardingDismissed: boolean;
  needsAttention: boolean;
  anyActive: boolean;
};

export const EMPTY_OVERVIEW: SetupOverview = {
  storeUrl: "",
  browsers: [],
  onboardingDismissed: false,
  needsAttention: false,
  anyActive: false,
};

/** Tauri command names — one place to fix a typo. */
export const SETUP_COMMANDS = {
  overview: "extension_setup_overview",
  openListing: "extension_setup_open_listing",
  openExtensionsPage: "extension_setup_open_extensions_page",
  skip: "extension_setup_skip",
  cancel: "extension_setup_cancel",
  setDismissed: "extension_setup_set_dismissed",
  reset: "extension_setup_reset",
} as const;
