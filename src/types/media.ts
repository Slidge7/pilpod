export const BROWSER_BRIDGE_PORT = 17399;

export type AudioSessionInfoDto = {
  instanceId: string;
  volume: number;
  muted: boolean;
};

export type BrowsersUpdatePayload = {
  browsers: DetectedBrowser[];
  browserAudio?: Record<string, AudioSessionInfoDto>;
  /**
   * Every profile of every detected browser, connected or not, keyed by
   * `osBrowserId`, in the browser's own order.
   */
  browserProfiles?: Record<string, BrowserProfileInfo[]>;
};

/** Companion state inside one browser profile. Mirrors Rust `ProfileCompanion`. */
export type ProfileCompanion = "notInstalled" | "disabled" | "installed";

/**
 * How a profile was tied to a companion connection:
 * `marker` (uninstall-URL marker), `storage` (found in the extension's own
 * storage) or `inferred` (the only possible match).
 */
export type ProfileLink = "marker" | "storage" | "inferred";

/** One browser profile on disk. Mirrors Rust `browser_profiles::BrowserProfileInfo`. */
export type BrowserProfileInfo = {
  /** Profile folder ("Default", "Profile 2"); "" when the browser has a single root profile. */
  dir: string;
  /** Name the browser shows for the profile ("Work"). */
  name: string;
  email?: string | null;
  /** Signed-in account's full name. */
  accountName?: string | null;
  /** Pass to `get_browser_profile_avatar`; absent ⇒ no picture, draw an initial. */
  avatarKey?: string | null;
  /** Profile colour, `#rrggbb`. */
  color?: string | null;
  lastUsed: boolean;
  /** The browser lists this profile as open (Chromium only). */
  open: boolean;
  companion: ProfileCompanion;
  /** Companion `browserId` living in this profile — matches `DetectedBrowser.id`. */
  browserId?: string | null;
  link?: ProfileLink | null;
  /** PilPod can open this profile directly. */
  canLaunch: boolean;
};

/** Per-window rollup derived from a profile's tabs (focused window first). */
export type BrowserWindowInfo = {
  windowId: number;
  focused: boolean;
  tabCount: number;
  audibleCount: number;
};

/**
 * Per-browser extension setup state. Mirrors Rust
 * `extension_setup::ActivationState`.
 *
 * - `inactive`     — detected, extension never verified
 * - `setupPending` — user is mid-install, awaiting the handshake
 * - `active`       — verified via the bridge; the only state that unlocks features
 * - `revoked`      — was active, extension has since gone missing
 * - `skipped`      — user declined; locked, but never prompted again
 */
export type ActivationState =
  | "inactive"
  | "setupPending"
  | "active"
  | "revoked"
  | "skipped";

export type DetectedBrowser = {
  id: string;
  osBrowserId: string;
  displayName: string;
  profileLabel?: string | null;
  running: boolean;
  /** @deprecated Superseded by `activationState`, which is not lossy. */
  extensionInstalled: boolean;
  activationState: ActivationState;
  extensionConnected: boolean;
  tabCount: number;
  tabs: BrowserTab[];
  windows?: BrowserWindowInfo[];
  lastSyncSecs: number | null;
  extensionReconnecting?: boolean;
  iconUrl?: string | null;
  /** The browser profile this row's companion lives in, when PilPod could tell. */
  profile?: BrowserProfileInfo | null;
};

export type WakeAndSyncBrowserResult = {
  osBrowserId: string;
  wasRunning: boolean;
  launched: boolean;
  connected: boolean;
  timedOut: boolean;
  waitMs: number;
  profiles: Array<{
    browserId: string;
    osBrowserId: string;
    extensionConnected: boolean;
    tabCount: number;
    tabs: BrowserTab[];
  }>;
  error: string | null;
};

export type BrowserTab = {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  favIconUrl?: string;
  faviconUrl?: string;
  tabState?: string;
  active?: boolean;
  windowFocused?: boolean;
  audible?: boolean;
  muted?: boolean;
  pinned?: boolean;
  index?: number;
  media?: TabMedia | null;
  browserId?: string;
};

export type TabMedia = {
  playbackState: string;
  mediaMatchRule?: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  duration?: number;
  currentTime?: number;
  pageVisible?: boolean;
  userIdleMs?: number;
  documentState?: string;
  tabVolume?: number;
  tabMuted?: boolean;
  canSeek?: boolean;
  canPip?: boolean;
  canNext?: boolean;
  canPrev?: boolean;
  inPip?: boolean;
};
