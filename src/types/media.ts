export const BROWSER_BRIDGE_PORT = 17399;

// ── WASAPI / GSMTC audio ─────────────────────────────────────────────────────

export type AudioSessionInfoDto = {
  instanceId: string;
  volume: number;
  muted: boolean;
};

// ── Windows GSMTC snapshot ───────────────────────────────────────────────────

export type GsmtcSnapshot = {
  version: number;
  sessions: MediaSessionDto[];
  /** Per-browser WASAPI audio, keyed by the extension's `browserId` UUID. */
  browserAudio?: Record<string, AudioSessionInfoDto>;
};

export type MediaSessionDto = {
  sessionIndex: number;
  sourceAppUserModelId: string;
  title: string;
  artist: string;
  album: string;
  subtitle: string;
  playbackStatus: string;
  playbackType: string | null;
  timeline: TimelineDto;
  controls: ControlsDto;
  thumbnailMime: string | null;
  thumbnailBase64: string | null;
  audio?: AudioSessionInfoDto | null;
};

export type TimelineDto = {
  startTicks: number;
  endTicks: number;
  positionTicks: number;
  minSeekTicks: number;
  maxSeekTicks: number;
  lastUpdatedUnixMs: number;
};

export type ControlsDto = {
  playPauseToggleEnabled: boolean;
  nextEnabled: boolean;
  previousEnabled: boolean;
};

// ── Browser / tab types ───────────────────────────────────────────────────────

/**
 * One entry per detected or active browser — emitted on `"browsers://update"`.
 * Browsers are detected at the OS level (registry + process scan); the extension
 * sets `extensionInstalled` and fills `tabs`.
 */
export type DetectedBrowser = {
  /**
   * Extension profile UUID when a slot exists; otherwise the OS browser id
   * (e.g. `"chrome"`) for placeholder rows with no extension yet.
   */
  id: string;
  /** OS-level browser key: `"chrome"`, `"msedge"`, etc. */
  osBrowserId: string;
  displayName: string;
  /** Disambiguates multiple profiles of the same OS browser. */
  profileLabel?: string | null;
  /** True when the browser process is currently running. */
  running: boolean;
  /**
   * True when the companion extension has ever successfully connected to
   * PilPod for this browser.  Persisted across app restarts; does NOT flip
   * off just because a heartbeat was missed.
   */
  extensionInstalled: boolean;
  /**
   * True when the extension sent a heartbeat in the last 3 seconds.
   * Separate from `extensionInstalled` so the UI can distinguish
   * "installed but currently disconnected" from "never installed".
   */
  extensionConnected: boolean;
  tabCount: number;
  tabs: BrowserTab[];
  /**
   * Seconds since the last successful POST from this browser's extension,
   * or `null` if no POST has been received in the current session.
   * Use this to display "Offline · cached 2 min ago" style hints.
   */
  lastSyncSecs: number | null;
  /** True briefly after system resume until the extension reconnects. */
  extensionReconnecting?: boolean;
};

/**
 * Unified tab representation — replaces the old split of media tabs vs all-tabs.
 * Every open tab is reported; `media` is present only when content is detected.
 */
export type BrowserTab = {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  /** From extension (`favIconUrl`) or Rust emit (`faviconUrl`). */
  favIconUrl?: string;
  faviconUrl?: string;
  /** "active" | "inactive" | "loading" | "sleeping" | "crashed" | "unknown" */
  tabState?: string;
  /** True when this is the selected tab in its window. */
  active?: boolean;
  /** True when the tab's window is the currently focused browser window. */
  windowFocused?: boolean;
  audible?: boolean;
  muted?: boolean;
  pinned?: boolean;
  index?: number;
  /** Present when the content script detected media; absent otherwise. */
  media?: TabMedia | null;
  /** Identifies which browser this tab belongs to (filled server-side). */
  browserId?: string;
};

/** Media details for a tab that has an active media element or MediaSession. */
export type TabMedia = {
  /** "playing" | "paused" | "none" */
  playbackState: string;
  title?: string;
  artist?: string;
  album?: string;
  /** Best-effort cover image from MediaSession artwork or video poster. */
  artworkUrl?: string;
  /** Track length in seconds (0 if unknown). */
  duration?: number;
  /** Playback position in seconds (0 if unknown). */
  currentTime?: number;
  /** `document.visibilityState === "visible"` from content script. */
  pageVisible?: boolean;
  /** Milliseconds since last user interaction on page. */
  userIdleMs?: number;
  /** document.readyState: "loading" | "interactive" | "complete" */
  documentState?: string;
};
