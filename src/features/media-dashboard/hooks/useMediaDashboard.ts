import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ALWAYS_ON_TOP_STORAGE_KEY } from "../constants";
import { useBrowsers } from "./useBrowsers";
import { useBrowserControls } from "./useBrowserControls";

/**
 * State for the main dashboard window.
 *
 * ## What used to live here
 *
 * This hook also drove "widget mode": it resized the main window down to a
 * 50×50 chip, saved and restored bounds, ran expand/collapse geometry, held a
 * transition lock and owned the drag gesture. All of it existed because the
 * widget *was* this window, which is exactly why the widget behaved like an
 * appendage of the app — it could only exist while the dashboard was
 * minimized.
 *
 * The widget now has its own window and its own document
 * (`src/features/widget`), with placement owned by Rust. What is left here is
 * what the dashboard actually is: browser data, media controls, and its own
 * window's always-on-top preference. Minimize means minimize again.
 */
export function useMediaDashboard() {
  const { browsers, browserAudio, refresh: refreshBrowsers } = useBrowsers();

  const [alwaysOnTop, setAlwaysOnTop] = useState(() => {
    try {
      return localStorage.getItem(ALWAYS_ON_TOP_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const writeAlwaysOnTop = useCallback((next: boolean) => {
    setAlwaysOnTop(next);
    try {
      localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* private mode / storage disabled — the window flag still applies */
    }
  }, []);

  useEffect(() => {
    void getCurrentWindow().setAlwaysOnTop(alwaysOnTop).catch(() => {});
  }, [alwaysOnTop]);

  /**
   * Drop always-on-top before handing focus to a browser.
   *
   * A pinned PilPod would otherwise sit in front of the window it just raised.
   * The short wait lets the window manager settle before the focus call lands.
   */
  const lowerForExternalFocus = useCallback(async () => {
    try {
      await getCurrentWindow().setAlwaysOnTop(false);
    } catch {
      /* running outside Tauri */
    }
    writeAlwaysOnTop(false);
    await new Promise((r) => setTimeout(r, 50));
  }, [writeAlwaysOnTop]);

  const controls = useBrowserControls(browsers, {
    onBeforeExternalFocus: lowerForExternalFocus,
  });

  const toggleAlwaysOnTop = useCallback(
    () => writeAlwaysOnTop(!alwaysOnTop),
    [alwaysOnTop, writeAlwaysOnTop],
  );

  const refresh = useCallback(async () => {
    void refreshBrowsers();
  }, [refreshBrowsers]);

  // Destructured, not `controls.refreshConnection`: `controls` is a fresh
  // object every render, so closing over it would give this callback a new
  // identity each time and defeat the memoized panel tree below it.
  const { refreshConnection } = controls;
  const refreshBrowserConnection = useCallback(
    async (browserId: string) => {
      await refreshConnection(browserId);
      await refreshBrowsers();
    },
    [refreshConnection, refreshBrowsers],
  );

  const minimizeApp = useCallback(() => {
    void getCurrentWindow().minimize().catch(() => {});
  }, []);

  const closeApp = useCallback(() => {
    void getCurrentWindow().close().catch(() => {});
  }, []);

  return {
    error: controls.error,
    alwaysOnTop,
    toggleAlwaysOnTop,
    refresh,

    // Browser tab actions
    browserPendingKeys: controls.pendingKeys,
    toggleBrowserTab: controls.toggleTab,
    focusBrowserTab: controls.focusTab,
    reactivateBrowserTab: controls.reactivateTab,
    reloadBrowserTab: controls.reloadTab,
    closeBrowserTab: controls.closeTab,
    seekBrowserTab: controls.seekTab,
    setTabVolumeBrowserTab: controls.setTabVolume,
    pipBrowserTab: controls.pip,
    resetTabVolumeBrowserTab: controls.resetTabVolume,
    resetAllBrowserTabVolumes: controls.resetAllVolumes,
    pauseAllBrowserTabs: controls.pauseAll,
    muteAllBrowserTabs: controls.muteAll,
    setMixerVolume: controls.setMixerVolume,
    refreshBrowserConnection,

    // Window
    minimizeApp,
    closeApp,

    browsers,
    browserAudio,
  };
}
