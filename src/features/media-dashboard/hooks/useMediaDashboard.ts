import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { BrowserTab } from "../../../types/media";
import {
  ALWAYS_ON_TOP_STORAGE_KEY,
  WIDGET_CHIP_LOGICAL_PX,
  WIDGET_DRAG_THRESHOLD_PX,
  WIDGET_ENABLED_STORAGE_KEY,
  WIDGET_EXPAND_BLUR_GRACE_MS,
  WIDGET_EXPANDED_HEIGHT_LOGICAL,
  WIDGET_EXPANDED_WIDTH_LOGICAL,
  WIDGET_TRANSITION_MS,
} from "../constants";
import { tabRowKey } from "../lib/browserMedia";
import type { MediaMainTab } from "../model";
import { useDownloader } from "../../downloader/hooks/useDownloader";
import { useWindowsSessions } from "../../windows-media";
import { useBrowsers } from "./useBrowsers";

export function useMediaDashboard() {
  const { browsers, refresh: refreshBrowsers } = useBrowsers();
  const windowsSessions = useWindowsSessions();
  const downloader = useDownloader();

  const [browserError, setBrowserError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MediaMainTab>("browser");
  const [pendingDownloadUrl, setPendingDownloadUrl] = useState<string | null>(
    null,
  );
  const [browserPendingKeys, setBrowserPendingKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [alwaysOnTop, setAlwaysOnTop] = useState(() => {
    try {
      return localStorage.getItem(ALWAYS_ON_TOP_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [widgetEnabled, setWidgetEnabled] = useState(() => {
    try {
      return localStorage.getItem(WIDGET_ENABLED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [isWidget, setIsWidget] = useState(false);
  const [isWidgetExpanded, setIsWidgetExpanded] = useState(false);
  const [dimmingToWidget, setDimmingToWidget] = useState(false);
  const [fullEnterActive, setFullEnterActive] = useState(false);
  const [fullEnterVisible, setFullEnterVisible] = useState(false);
  const windowTransitionLock = useRef(false);
  const widgetGeometryLock = useRef(false);
  const isWidgetExpandedRef = useRef(false);
  const widgetBlurGraceUntilRef = useRef(0);
  const collapseWidgetPanelRef = useRef<() => Promise<void>>(async () => {});

  const browserPendingTimeouts = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  const clearBrowserPending = useCallback((key: string) => {
    const id = browserPendingTimeouts.current.get(key);
    if (id !== undefined) {
      clearTimeout(id);
      browserPendingTimeouts.current.delete(key);
    }
    setBrowserPendingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const markBrowserPending = useCallback(
    (key: string) => {
      const existing = browserPendingTimeouts.current.get(key);
      if (existing !== undefined) clearTimeout(existing);
      const id = setTimeout(() => {
        browserPendingTimeouts.current.delete(key);
        clearBrowserPending(key);
      }, 8_000);
      browserPendingTimeouts.current.set(key, id);
      setBrowserPendingKeys((prev) => new Set(prev).add(key));
    },
    [clearBrowserPending],
  );

  /** Trigger a full refresh: GSMTC snapshot + browser list. */
  const refresh = useCallback(async () => {
    void windowsSessions.refresh();
    void refreshBrowsers();
  }, [windowsSessions.refresh, refreshBrowsers]);

  useEffect(() => {
    if (isWidget) return;
    void getCurrentWindow()
      .setAlwaysOnTop(alwaysOnTop)
      .catch(() => {});
  }, [alwaysOnTop, isWidget]);

  useEffect(() => {
    if (!isWidget) return;
    void getCurrentWindow().setAlwaysOnTop(true).catch(() => {});
  }, [isWidget]);

  useEffect(() => {
    isWidgetExpandedRef.current = isWidgetExpanded;
  }, [isWidgetExpanded]);

  const lowerPilPodForExternalFocus = useCallback(async () => {
    const win = getCurrentWindow();
    try {
      await win.setAlwaysOnTop(false);
    } catch {
      /* running in normal browser */
    }
    setAlwaysOnTop(false);
    try {
      localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, "0");
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 50));
  }, []);

  const toggleBrowserTab = useCallback(
    async (t: BrowserTab, browserId: string) => {
      const key = tabRowKey(t);
      markBrowserPending(key);
      setBrowserError(null);
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId: t.tabId,
          action: "playPause",
        });
      } catch (e) {
        setBrowserError(String(e));
      } finally {
        clearBrowserPending(key);
      }
    },
    [clearBrowserPending, markBrowserPending],
  );

  const focusBrowserTab = useCallback(
    async (t: BrowserTab, browserId: string, browserDisplayName: string) => {
      setBrowserError(null);
      await lowerPilPodForExternalFocus();
      const key = tabRowKey(t);
      markBrowserPending(key);
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId: t.tabId,
          action: "focusTab",
          tabTitleForFocus: t.title?.trim() ?? "",
          browserWindowHint: browserDisplayName,
        });
      } catch (e) {
        setBrowserError(String(e));
      } finally {
        clearBrowserPending(key);
      }
    },
    [clearBrowserPending, lowerPilPodForExternalFocus, markBrowserPending],
  );

  const reloadBrowserTab = useCallback(
    async (t: BrowserTab, browserId: string) => {
      const key = tabRowKey(t);
      markBrowserPending(key);
      setBrowserError(null);
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId: t.tabId,
          action: "reloadTab",
        });
      } catch (e) {
        setBrowserError(String(e));
      } finally {
        clearBrowserPending(key);
      }
    },
    [clearBrowserPending, markBrowserPending],
  );

  const closeBrowserTab = useCallback(
    async (t: BrowserTab, browserId: string) => {
      const key = tabRowKey(t);
      markBrowserPending(key);
      setBrowserError(null);
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId: t.tabId,
          action: "closeTab",
        });
      } catch (e) {
        setBrowserError(String(e));
      } finally {
        clearBrowserPending(key);
      }
    },
    [clearBrowserPending, markBrowserPending],
  );

  const reactivateBrowserTab = useCallback(
    async (t: BrowserTab, browserId: string) => {
      const key = tabRowKey(t);
      markBrowserPending(key);
      setBrowserError(null);
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId: t.tabId,
          action: "reactivateTab",
        });
      } catch (e) {
        setBrowserError(String(e));
      } finally {
        clearBrowserPending(key);
      }
    },
    [clearBrowserPending, markBrowserPending],
  );

  const toggleWidgetEnabled = useCallback(() => {
    setWidgetEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(WIDGET_ENABLED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleAlwaysOnTop = useCallback(() => {
    setAlwaysOnTop((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const minimizeToWidgetMode = useCallback(async () => {
    if (windowTransitionLock.current || isWidget) return;
    windowTransitionLock.current = true;
    setDimmingToWidget(true);
    window.setTimeout(async () => {
      try {
        await invoke("toggle_widget_mode", { isMini: true });
        setIsWidgetExpanded(false);
        setIsWidget(true);
      } catch (e) {
        setBrowserError(String(e));
      } finally {
        setDimmingToWidget(false);
        windowTransitionLock.current = false;
      }
    }, WIDGET_TRANSITION_MS);
  }, [isWidget]);

  const minimizeApp = useCallback(() => {
    if (!widgetEnabled) {
      void getCurrentWindow().minimize().catch(() => {});
      return;
    }
    void minimizeToWidgetMode();
  }, [widgetEnabled, minimizeToWidgetMode]);

  const expandWidgetPanel = useCallback(async () => {
    if (!isWidget || isWidgetExpanded || widgetGeometryLock.current) return;
    widgetGeometryLock.current = true;
    try {
      const win = getCurrentWindow();
      const sf = await win.scaleFactor();
      const op = await win.outerPosition();
      const os = await win.outerSize();
      const lx = op.x / sf;
      const ly = op.y / sf;
      const wL = os.width / sf;
      const hL = os.height / sf;
      const brX = lx + wL;
      const brY = ly + hL;

      await win.setSize(
        new LogicalSize(
          WIDGET_EXPANDED_WIDTH_LOGICAL,
          WIDGET_EXPANDED_HEIGHT_LOGICAL,
        ),
      );
      const os2 = await win.outerSize();
      const wL2 = os2.width / sf;
      const hL2 = os2.height / sf;
      await win.setPosition(new LogicalPosition(brX - wL2, brY - hL2));
      void win.setAlwaysOnTop(true).catch(() => {});
      widgetBlurGraceUntilRef.current = Date.now() + WIDGET_EXPAND_BLUR_GRACE_MS;
      setIsWidgetExpanded(true);
    } catch (e) {
      setBrowserError(String(e));
    } finally {
      widgetGeometryLock.current = false;
    }
  }, [isWidget, isWidgetExpanded]);

  const collapseWidgetPanel = useCallback(async () => {
    if (!isWidget || !isWidgetExpanded || widgetGeometryLock.current) return;
    widgetGeometryLock.current = true;
    try {
      const win = getCurrentWindow();
      const sf = await win.scaleFactor();
      const op = await win.outerPosition();
      const os = await win.outerSize();
      const lx = op.x / sf;
      const ly = op.y / sf;
      const wL = os.width / sf;
      const hL = os.height / sf;
      const brX = lx + wL;
      const brY = ly + hL;

      await win.setSize(
        new LogicalSize(WIDGET_CHIP_LOGICAL_PX, WIDGET_CHIP_LOGICAL_PX),
      );
      const os2 = await win.outerSize();
      const wL2 = os2.width / sf;
      const hL2 = os2.height / sf;
      await win.setPosition(new LogicalPosition(brX - wL2, brY - hL2));
      void win.setAlwaysOnTop(true).catch(() => {});
      setIsWidgetExpanded(false);
    } catch (e) {
      setBrowserError(String(e));
    } finally {
      widgetGeometryLock.current = false;
    }
  }, [isWidget, isWidgetExpanded]);

  useEffect(() => {
    collapseWidgetPanelRef.current = collapseWidgetPanel;
  }, [collapseWidgetPanel]);

  useEffect(() => {
    if (!isWidget) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) return;
        if (Date.now() < widgetBlurGraceUntilRef.current) return;
        if (!isWidgetExpandedRef.current) return;
        void collapseWidgetPanelRef.current();
      })
      .then((u) => {
        unlisten = u;
      });
    return () => {
      void unlisten?.();
    };
  }, [isWidget]);

  const restoreFromWidget = useCallback(async () => {
    if (windowTransitionLock.current || !isWidget) return;
    windowTransitionLock.current = true;
    setIsWidgetExpanded(false);
    try {
      await invoke("toggle_widget_mode", { isMini: false });
      setIsWidget(false);
      void getCurrentWindow().setAlwaysOnTop(alwaysOnTop).catch(() => {});
      setFullEnterActive(true);
      setFullEnterVisible(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setFullEnterVisible(true);
          window.setTimeout(() => {
            setFullEnterActive(false);
            setFullEnterVisible(false);
            windowTransitionLock.current = false;
          }, WIDGET_TRANSITION_MS + 40);
        });
      });
    } catch (e) {
      setBrowserError(String(e));
      windowTransitionLock.current = false;
    }
  }, [alwaysOnTop, isWidget]);

  const clearPendingDownloadUrl = useCallback(() => {
    setPendingDownloadUrl(null);
  }, []);

  const downloadFromBrowserTab = useCallback(
    async (url: string) => {
      setPendingDownloadUrl(url);
      setMainTab("download");
      if (isWidget) {
        await restoreFromWidget();
      }
    },
    [isWidget, restoreFromWidget],
  );

  const dismissWidgetAndDisable = useCallback(async () => {
    if (windowTransitionLock.current || !isWidget) return;
    windowTransitionLock.current = true;
    setIsWidgetExpanded(false);
    try {
      try {
        localStorage.setItem(WIDGET_ENABLED_STORAGE_KEY, "0");
      } catch {
        /* ignore */
      }
      setWidgetEnabled(false);
      await invoke("toggle_widget_mode", { isMini: false });
      void getCurrentWindow().setAlwaysOnTop(alwaysOnTop).catch(() => {});
      await getCurrentWindow().minimize().catch(() => {});
      setIsWidget(false);
    } catch (e) {
      setBrowserError(String(e));
    } finally {
      windowTransitionLock.current = false;
    }
  }, [alwaysOnTop, isWidget]);

  const closeApp = useCallback(() => {
    void getCurrentWindow().close().catch(() => {});
  }, []);

  const widgetGestureRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    dragged: boolean;
  } | null>(null);

  const onWidgetSurfacePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      widgetGestureRef.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        dragged: false,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onWidgetSurfacePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const g = widgetGestureRef.current;
      if (!g || e.pointerId !== g.pointerId || g.dragged) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (
        dx * dx + dy * dy >=
        WIDGET_DRAG_THRESHOLD_PX * WIDGET_DRAG_THRESHOLD_PX
      ) {
        g.dragged = true;
        void getCurrentWindow().startDragging();
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
        widgetGestureRef.current = null;
      }
    },
    [],
  );

  const endWidgetSurfacePointer = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, isCancel: boolean) => {
      const g = widgetGestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* */
      }
      const dragged = g.dragged;
      widgetGestureRef.current = null;
      if (!dragged && !isCancel && e.button === 0) {
        void expandWidgetPanel();
      }
    },
    [expandWidgetPanel],
  );

  const onWidgetSurfacePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      endWidgetSurfacePointer(e, false);
    },
    [endWidgetSurfacePointer],
  );

  const onWidgetSurfacePointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      endWidgetSurfacePointer(e, true);
    },
    [endWidgetSurfacePointer],
  );

  const refreshBrowserConnection = useCallback(async (browserId: string) => {
    setBrowserError(null);
    try {
      await invoke("refresh_browser_connection", { browserId });
    } catch (e) {
      setBrowserError(String(e));
    }
  }, []);

  const error = windowsSessions.error ?? browserError;

  return {
    error,
    mainTab,
    setMainTab,
    pendingDownloadUrl,
    clearPendingDownloadUrl,
    downloadFromBrowserTab,
    downloader,
    alwaysOnTop,
    toggleAlwaysOnTop,
    refresh,
    widgetEnabled,
    toggleWidgetEnabled,
    isWidget,
    isWidgetExpanded,
    dimmingToWidget,
    fullEnterActive,
    fullEnterVisible,
    // Browser tab actions
    toggleBrowserTab,
    focusBrowserTab,
    reactivateBrowserTab,
    reloadBrowserTab,
    closeBrowserTab,
    browserPendingKeys,
    minimizeApp,
    expandWidgetPanel,
    restoreFromWidget,
    dismissWidgetAndDisable,
    closeApp,
    widgetGestures: {
      onPointerDown: onWidgetSurfacePointerDown,
      onPointerMove: onWidgetSurfacePointerMove,
      onPointerUp: onWidgetSurfacePointerUp,
      onPointerCancel: onWidgetSurfacePointerCancel,
    },
    refreshBrowserConnection,
    browsers,
    // Windows media (delegated to useWindowsSessions)
    sessions: windowsSessions.sessions,
    winPendingKeys: windowsSessions.pendingKeys,
    toggleWinSession: windowsSessions.toggleSession,
    setMixerVolume: windowsSessions.setMixerVolume,
    browserAudio: windowsSessions.browserAudio,
  };
}
