import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AudioSessionInfoDto,
  BrowserTab,
  GsmtcSnapshot,
  MediaSessionDto,
} from "../../../types/media";
import {
  ALWAYS_ON_TOP_STORAGE_KEY,
  GSMTC_INIT_ERROR_EVENT,
  GSMTC_UPDATE_EVENT,
  WIDGET_CHIP_LOGICAL_PX,
  WIDGET_DRAG_THRESHOLD_PX,
  WIDGET_ENABLED_STORAGE_KEY,
  WIDGET_EXPAND_BLUR_GRACE_MS,
  WIDGET_EXPANDED_HEIGHT_LOGICAL,
  WIDGET_EXPANDED_WIDTH_LOGICAL,
  WIDGET_TRANSITION_MS,
} from "../constants";
import { tabRowKey } from "../lib/browserMedia";
import { winRowKey } from "../lib/windowsMedia";
import type { MediaMainTab } from "../model";
import { useBrowsers } from "./useBrowsers";

export function useMediaDashboard() {
  const { browsers, refresh: refreshBrowsers } = useBrowsers();
  const [snapshot, setSnapshot] = useState<GsmtcSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MediaMainTab>("browser");
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(
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

  // One timeout handle per pending key — auto-clears stale spinners if the
  // backend fails silently and the finally block never fires.
  const pendingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const clearPending = useCallback((key: string) => {
    const id = pendingTimeouts.current.get(key);
    if (id !== undefined) {
      clearTimeout(id);
      pendingTimeouts.current.delete(key);
    }
    setPendingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const markPending = useCallback(
    (key: string) => {
      // Cancel any pre-existing timeout for this key before arming a new one.
      const existing = pendingTimeouts.current.get(key);
      if (existing !== undefined) clearTimeout(existing);

      const id = setTimeout(() => {
        pendingTimeouts.current.delete(key);
        clearPending(key);
      }, 8_000);
      pendingTimeouts.current.set(key, id);

      setPendingKeys((prev) => new Set(prev).add(key));
    },
    [clearPending],
  );

  const refresh = useCallback(async (retries = 12) => {
    try {
      setError(null);
      const snap = await invoke<GsmtcSnapshot>("gsmtc_refresh");
      setSnapshot(snap);
      void refreshBrowsers();
    } catch (e) {
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, 120));
        return refresh(retries - 1);
      }
      setError(String(e));
    }
  }, [refreshBrowsers]);

  useEffect(() => {
    if (isWidget) return;
    void getCurrentWindow()
      .setAlwaysOnTop(alwaysOnTop)
      .catch(() => {
        /* e.g. Vite dev in a normal browser */
      });
  }, [alwaysOnTop, isWidget]);

  useEffect(() => {
    if (!isWidget) return;
    void getCurrentWindow().setAlwaysOnTop(true).catch(() => {
      /* e.g. Vite dev in a normal browser */
    });
  }, [isWidget]);

  useEffect(() => {
    isWidgetExpandedRef.current = isWidgetExpanded;
  }, [isWidgetExpanded]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let unlistenInitError: UnlistenFn | undefined;

    void listen<GsmtcSnapshot>(GSMTC_UPDATE_EVENT, (ev) => {
      setSnapshot(ev.payload);
      setError(null);
    }).then((u) => {
      unlisten = u;
    });

    void listen<{ message: string }>(GSMTC_INIT_ERROR_EVENT, (ev) => {
      setError(ev.payload.message);
    }).then((u) => {
      unlistenInitError = u;
    });

    void refresh();
    return () => {
      void unlisten?.();
      void unlistenInitError?.();
    };
  }, [refresh]);

  const lowerPilPodForExternalFocus = useCallback(async () => {
    const win = getCurrentWindow();
    try {
      await win.setAlwaysOnTop(false);
    } catch {
      /* e.g. running in normal browser */
    }
    setAlwaysOnTop(false);
    try {
      localStorage.setItem(ALWAYS_ON_TOP_STORAGE_KEY, "0");
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 50));
  }, []);

  /** Toggle play/pause on a tab with active media. */
  const toggleBrowserTab = useCallback(
    async (t: BrowserTab, browserId: string) => {
      const key = tabRowKey(t);
      markPending(key);
      setError(null);
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId: t.tabId,
          action: "playPause",
        });
      } catch (e) {
        setError(String(e));
      } finally {
        clearPending(key);
      }
    },
    [clearPending, markPending],
  );

  /** Focus a browser tab (brings its window to the foreground). */
  const focusBrowserTab = useCallback(
    async (t: BrowserTab, browserId: string, browserDisplayName: string) => {
      setError(null);
      await lowerPilPodForExternalFocus();
      const key = tabRowKey(t);
      markPending(key);
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId: t.tabId,
          action: "focusTab",
          tabTitleForFocus: t.title?.trim() ?? "",
          browserWindowHint: browserDisplayName,
        });
      } catch (e) {
        setError(String(e));
      } finally {
        clearPending(key);
      }
    },
    [clearPending, lowerPilPodForExternalFocus, markPending],
  );

  /** Reload a tab (clears sleeping/crashed state). */
  const reloadBrowserTab = useCallback(
    async (t: BrowserTab, browserId: string) => {
      const key = tabRowKey(t);
      markPending(key);
      setError(null);
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId: t.tabId,
          action: "reloadTab",
        });
      } catch (e) {
        setError(String(e));
      } finally {
        clearPending(key);
      }
    },
    [clearPending, markPending],
  );

  /** Close a browser tab. */
  const closeBrowserTab = useCallback(
    async (t: BrowserTab, browserId: string) => {
      const key = tabRowKey(t);
      markPending(key);
      setError(null);
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId: t.tabId,
          action: "closeTab",
        });
      } catch (e) {
        setError(String(e));
      } finally {
        clearPending(key);
      }
    },
    [clearPending, markPending],
  );

  /** Wake a sleeping or crashed tab. */
  const reactivateBrowserTab = useCallback(
    async (t: BrowserTab, browserId: string) => {
      const key = tabRowKey(t);
      markPending(key);
      setError(null);
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId: t.tabId,
          action: "reactivateTab",
        });
      } catch (e) {
        setError(String(e));
      } finally {
        clearPending(key);
      }
    },
    [clearPending, markPending],
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
        setError(String(e));
      } finally {
        setDimmingToWidget(false);
        windowTransitionLock.current = false;
      }
    }, WIDGET_TRANSITION_MS);
  }, [isWidget]);

  const minimizeApp = useCallback(() => {
    if (!widgetEnabled) {
      void getCurrentWindow()
        .minimize()
        .catch(() => {
          /* e.g. Vite dev in a normal browser */
        });
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
        new LogicalSize(WIDGET_EXPANDED_WIDTH_LOGICAL, WIDGET_EXPANDED_HEIGHT_LOGICAL),
      );
      const os2 = await win.outerSize();
      const wL2 = os2.width / sf;
      const hL2 = os2.height / sf;
      await win.setPosition(new LogicalPosition(brX - wL2, brY - hL2));
      void win.setAlwaysOnTop(true).catch(() => {});
      widgetBlurGraceUntilRef.current = Date.now() + WIDGET_EXPAND_BLUR_GRACE_MS;
      setIsWidgetExpanded(true);
    } catch (e) {
      setError(String(e));
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

      await win.setSize(new LogicalSize(WIDGET_CHIP_LOGICAL_PX, WIDGET_CHIP_LOGICAL_PX));
      const os2 = await win.outerSize();
      const wL2 = os2.width / sf;
      const hL2 = os2.height / sf;
      await win.setPosition(new LogicalPosition(brX - wL2, brY - hL2));
      void win.setAlwaysOnTop(true).catch(() => {});
      setIsWidgetExpanded(false);
    } catch (e) {
      setError(String(e));
    } finally {
      widgetGeometryLock.current = false;
    }
  }, [isWidget, isWidgetExpanded]);

  useEffect(() => {
    collapseWidgetPanelRef.current = collapseWidgetPanel;
  }, [collapseWidgetPanel]);

  useEffect(() => {
    if (!isWidget) return;
    let unlisten: UnlistenFn | undefined;
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
      void getCurrentWindow()
        .setAlwaysOnTop(alwaysOnTop)
        .catch(() => {
          /* browser dev */
        });
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
      setError(String(e));
      windowTransitionLock.current = false;
    }
  }, [alwaysOnTop, isWidget]);

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
      void getCurrentWindow()
        .setAlwaysOnTop(alwaysOnTop)
        .catch(() => {
          /* browser dev */
        });

      await getCurrentWindow()
        .minimize()
        .catch(() => {
          /* e.g. Vite dev in a normal browser */
        });

      setIsWidget(false);
    } catch (e) {
      setError(String(e));
    } finally {
      windowTransitionLock.current = false;
    }
  }, [alwaysOnTop, isWidget]);

  const closeApp = useCallback(() => {
    void getCurrentWindow().close().catch(() => {
      /* browser dev */
    });
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

  const toggleWinSession = useCallback(
    async (s: MediaSessionDto) => {
      const key = winRowKey(s);
      markPending(key);
      setError(null);
      try {
        await invoke("gsmtc_toggle_play_pause", {
          aumid: s.sourceAppUserModelId,
        });
      } catch (e) {
        setError(String(e));
      } finally {
        clearPending(key);
      }
    },
    [clearPending, markPending],
  );

  const setMixerVolume = useCallback(async (instanceId: string, volume: number) => {
    setError(null);
    try {
      await invoke("mixer_set_volume", { instanceId, volume });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /**
   * Drop the active extension slot for a browser so `extensionConnected` resets
   * to false immediately, then let the extension's next heartbeat restore it.
   * The persisted `extensionInstalled` flag is left unchanged.
   */
  const refreshBrowserConnection = useCallback(async (browserId: string) => {
    setError(null);
    try {
      await invoke("refresh_browser_connection", { browserId });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const sessions = snapshot?.sessions ?? [];
  const browserAudio: Record<string, AudioSessionInfoDto> =
    snapshot?.browserAudio ?? {};

  return {
    error,
    mainTab,
    setMainTab,
    pendingKeys,
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
    // Browser actions (unified — work on any tab via BrowserTab + browserId)
    toggleBrowserTab,
    focusBrowserTab,
    reactivateBrowserTab,
    reloadBrowserTab,
    closeBrowserTab,
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
    toggleWinSession,
    setMixerVolume,
    refreshBrowserConnection,
    sessions,
    browsers,
    browserAudio,
  };
}
