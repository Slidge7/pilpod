import type { BrowserTab, BrowsersUpdatePayload } from "../../types/media";

/** Mirror of Rust `DevBrowserProcessState`. */
export type DevBrowserProcessState =
  | "notInstalled"
  | "notRunning"
  | "portable"
  | "active"
  | "inactive"
  | "notResponding"
  | "running";

/** Mirror of Rust `DevOsBrowserScanRow` — OS truth per catalog browser. */
export type DevOsRow = {
  id: string;
  displayName: string;
  installed: boolean;
  running: boolean;
  processState: DevBrowserProcessState;
  processCount: number;
  extensionInstalledOs: boolean;
  iconUrl: string | null;
};

/** Mirror of Rust `DevSlotRow` — one extension profile slot, pre-merge. */
export type DevSlotRow = {
  browserId: string;
  reportedName: string;
  osBrowserId: string;
  /** "pidVerified" (socket-owner ground truth) or "selfReport" (UA fallback). */
  binding: "pidVerified" | "selfReport";
  selfReportOsId: string;
  bindingConflict: boolean;
  wsConnected: boolean;
  heartbeatFresh: boolean;
  lastSeenSecs: number;
  reconnecting: boolean;
  extInstalledPersisted: boolean;
  tabCount: number;
  windowCount: number;
  audibleCount: number;
  contentHash: string;
  tabs: BrowserTab[];
};

/** Mirror of Rust `DevFullState`. */
export type DevFullState = {
  generatedAtMs: number;
  osRows: DevOsRow[];
  slots: DevSlotRow[];
  merged: BrowsersUpdatePayload;
};

/** Mirror of Rust `DevWakeAndSyncResult` (subset the UI uses). */
export type DevWakeAndSyncResult = {
  osBrowserId: string;
  wasRunning: boolean;
  launched: boolean;
  connected: boolean;
  timedOut: boolean;
  waitMs: number;
  error: string | null;
};
