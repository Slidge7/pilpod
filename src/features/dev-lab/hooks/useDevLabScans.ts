import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BrowserTab, DetectedBrowser, GsmtcSnapshot } from "../../../types/media";

export type DevOsBrowserRow = {
  id: string;
  displayName: string;
  running: boolean;
};

export type DevBrowserTabProfile = {
  browserId: string;
  profileLabel?: string | null;
  extensionInstalled: boolean;
  extensionConnected: boolean;
  tabCount: number;
  tabs: BrowserTab[];
};

export type DevWakeAndSyncResult = {
  osBrowserId: string;
  wasRunning: boolean;
  launched: boolean;
  connected: boolean;
  timedOut: boolean;
  waitMs: number;
  profiles: DevBrowserTabProfile[];
  error: string | null;
};

export type DevBrowserTabScan = {
  scannedAt: Date;
  profiles: DevBrowserTabProfile[];
};

type ScanKind = "media" | "browsers" | null;

const TAB_SYNC_WAIT_MS = 450;

function profilesForOsBrowser(
  all: DetectedBrowser[],
  osBrowserId: string,
): DevBrowserTabProfile[] {
  return all
    .filter((b) => b.osBrowserId === osBrowserId)
    .map((b) => ({
      browserId: b.id,
      profileLabel: b.profileLabel,
      extensionInstalled: b.extensionInstalled,
      extensionConnected: b.extensionConnected,
      tabCount: b.tabCount,
      tabs: b.tabs,
    }));
}

export function useDevLabScans() {
  const [mediaSnapshot, setMediaSnapshot] = useState<GsmtcSnapshot | null>(null);
  const [mediaScannedAt, setMediaScannedAt] = useState<Date | null>(null);
  const [browsers, setBrowsers] = useState<DevOsBrowserRow[]>([]);
  const [browsersScannedAt, setBrowsersScannedAt] = useState<Date | null>(null);
  const [browserTabScans, setBrowserTabScans] = useState<
    Record<string, DevBrowserTabScan>
  >({});
  const [loading, setLoading] = useState<ScanKind>(null);
  const [tabScanLoadingId, setTabScanLoadingId] = useState<string | null>(null);
  const [wakeResults, setWakeResults] = useState<
    Record<string, DevWakeAndSyncResult>
  >({});
  const [wakingBrowsers, setWakingBrowsers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const scanMedia = useCallback(async () => {
    setLoading("media");
    setError(null);
    try {
      const snapshot = await invoke<GsmtcSnapshot>("gsmtc_refresh");
      setMediaSnapshot(snapshot);
      setMediaScannedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }, []);

  const scanBrowsers = useCallback(async () => {
    setLoading("browsers");
    setError(null);
    try {
      const rows = await invoke<DevOsBrowserRow[]>("dev_scan_os_browsers");
      setBrowsers(rows);
      setBrowsersScannedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }, []);

  const scanTabsForBrowser = useCallback(async (osBrowserId: string) => {
    setTabScanLoadingId(osBrowserId);
    setError(null);
    try {
      await invoke("request_browser_sync");
      await new Promise((resolve) => setTimeout(resolve, TAB_SYNC_WAIT_MS));

      let all = await invoke<DetectedBrowser[]>("get_browsers");
      const matching = all.filter((b) => b.osBrowserId === osBrowserId);

      for (const browser of matching) {
        if (browser.extensionInstalled && browser.id !== browser.osBrowserId) {
          await invoke("refresh_browser_connection", { browserId: browser.id });
        }
      }

      if (matching.some((b) => b.extensionInstalled)) {
        await invoke("request_browser_sync");
        await new Promise((resolve) => setTimeout(resolve, TAB_SYNC_WAIT_MS));
        all = await invoke<DetectedBrowser[]>("get_browsers");
      }

      setBrowserTabScans((prev) => ({
        ...prev,
        [osBrowserId]: {
          scannedAt: new Date(),
          profiles: profilesForOsBrowser(all, osBrowserId),
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTabScanLoadingId(null);
    }
  }, []);

  const wakeAndSyncBrowser = useCallback(async (osBrowserId: string) => {
    setWakingBrowsers((prev) => new Set(prev).add(osBrowserId));
    setError(null);

    try {
      const result = await invoke<DevWakeAndSyncResult>("dev_wake_and_sync_browser", {
        osBrowserId,
      });

      setWakeResults((prev) => ({ ...prev, [osBrowserId]: result }));

      const rows = await invoke<DevOsBrowserRow[]>("dev_scan_os_browsers");
      setBrowsers(rows);
      setBrowsersScannedAt(new Date());

      if (result.profiles.length > 0) {
        setBrowserTabScans((prev) => ({
          ...prev,
          [osBrowserId]: {
            scannedAt: new Date(),
            profiles: result.profiles.map((p) => ({
              browserId: p.browserId,
              extensionInstalled: true,
              extensionConnected: p.extensionConnected,
              tabCount: p.tabCount,
              tabs: p.tabs,
            })),
          },
        }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setWakeResults((prev) => ({
        ...prev,
        [osBrowserId]: {
          osBrowserId,
          wasRunning: false,
          launched: false,
          connected: false,
          timedOut: false,
          waitMs: 0,
          profiles: [],
          error: message,
        },
      }));
      setError(message);
    } finally {
      setWakingBrowsers((prev) => {
        const next = new Set(prev);
        next.delete(osBrowserId);
        return next;
      });
    }
  }, []);

  return {
    mediaSnapshot,
    mediaScannedAt,
    browsers,
    browsersScannedAt,
    browserTabScans,
    tabScanLoadingId,
    wakeResults,
    wakingBrowsers,
    loading,
    error,
    scanMedia,
    scanBrowsers,
    scanTabsForBrowser,
    wakeAndSyncBrowser,
  };
}
