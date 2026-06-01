export const BROWSER_BRIDGE_PORT = 17399;

export type AudioSessionInfoDto = {
  instanceId: string;
  volume: number;
  muted: boolean;
};

export type BrowsersUpdatePayload = {
  browsers: DetectedBrowser[];
  browserAudio?: Record<string, AudioSessionInfoDto>;
};

export type DetectedBrowser = {
  id: string;
  osBrowserId: string;
  displayName: string;
  profileLabel?: string | null;
  running: boolean;
  extensionInstalled: boolean;
  extensionConnected: boolean;
  tabCount: number;
  tabs: BrowserTab[];
  lastSyncSecs: number | null;
  extensionReconnecting?: boolean;
  iconUrl?: string | null;
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
};
