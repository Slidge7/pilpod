import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  BrowserTabMediaDto,
  GsmtcSnapshot,
  MediaSessionDto,
} from "../../../types/media";
import {
  ALWAYS_ON_TOP_STORAGE_KEY,
  GSMTC_UPDATE_EVENT,
  WIDGET_DRAG_THRESHOLD_PX,
  WIDGET_TRANSITION_MS,
} from "../constants";
import { browserRowKey, groupBrowserTabsByProfile } from "../lib/browserMedia";
import { winRowKey } from "../lib/windowsMedia";
import type { MediaMainTab } from "../model";

export function useMediaDashboard() {
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
  const [isWidget, setIsWidget] = useState(false);
  const [dimmingToWidget, setDimmingToWidget] = useState(false);
  const [fullEnterActive, setFullEnterActive] = useState(false);
  const [fullEnterVisible, setFullEnterVisible] = useState(false);
  const windowTransitionLock = useRef(false);

  const markPending = useCallback((key: string) => {
    setPendingKeys((prev) => new Set(prev).add(key));
  }, []);

  const clearPending = useCallback((key: string) => {
    setPendingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const refresh = useCallback(async (retries = 12) => {
    try {
      setError(null);
      const snap = await invoke<GsmtcSnapshot>("gsmtc_refresh");
      setSnapshot(snap);
    } catch (e) {
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, 120));
        return refresh(retries - 1);
      }
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (isWidget) return;
    void getCurrentWindow()
      .setAlwaysOnTop(alwaysOnTop)
      .catch(() => {
        /* e.g. Vite dev in a normal browser */
      });
  }, [alwaysOnTop, isWidget]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<GsmtcSnapshot>(GSMTC_UPDATE_EVENT, (ev) => {
      setSnapshot(ev.payload);
      setError(null);
    }).then((u) => {
      unlisten = u;
    });
    void refresh();
    return () => {
      void unlisten?.();
    };
  }, [refresh]);

  const toggleBrowser = useCallback(
    async (t: BrowserTabMediaDto) => {
      const key = browserRowKey(t);
      markPending(key);
      setError(null);
      try {
        await invoke("browser_media_control", {
          browserId: t.browserId,
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

  const focusBrowserTab = useCallback(async (t: BrowserTabMediaDto) => {
    setError(null);
    // If PilPod stays above other windows, the browser cannot appear in front —
    // Windows may only flash the taskbar. Lower PilPod first; user can re-pin
    // from the header (or widget close) when they want the dashboard on top again.
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
    // Let the window manager apply z-order before the browser asks for focus
    // (extension runs shortly after the next heartbeat).
    await new Promise((r) => setTimeout(r, 50));
    try {
      await invoke("browser_media_control", {
        browserId: t.browserId,
        tabId: t.tabId,
        action: "focusTab",
        tabTitleForFocus: t.title?.trim() ?? "",
        browserWindowHint: t.browserName?.trim() ?? "",
      });
    } catch (e) {
      setError(String(e));
    }
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
        setIsWidget(true);
      } catch (e) {
        setError(String(e));
      } finally {
        setDimmingToWidget(false);
        windowTransitionLock.current = false;
      }
    }, WIDGET_TRANSITION_MS);
  }, [isWidget]);

  const restoreFromWidget = useCallback(async () => {
    if (windowTransitionLock.current || !isWidget) return;
    windowTransitionLock.current = true;
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
        void restoreFromWidget();
      }
    },
    [restoreFromWidget],
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
          sessionIndex: s.sessionIndex,
        });
      } catch (e) {
        setError(String(e));
      } finally {
        clearPending(key);
      }
    },
    [clearPending, markPending],
  );

  const sessions = snapshot?.sessions ?? [];
  const browserTabs = snapshot?.browserTabs ?? [];
  const browserProfileGroups = useMemo(
    () => groupBrowserTabsByProfile(browserTabs),
    [browserTabs],
  );

  return {
    error,
    mainTab,
    setMainTab,
    pendingKeys,
    alwaysOnTop,
    toggleAlwaysOnTop,
    refresh,
    isWidget,
    dimmingToWidget,
    fullEnterActive,
    fullEnterVisible,
    toggleBrowser,
    focusBrowserTab,
    minimizeToWidgetMode,
    restoreFromWidget,
    closeApp,
    widgetGestures: {
      onPointerDown: onWidgetSurfacePointerDown,
      onPointerMove: onWidgetSurfacePointerMove,
      onPointerUp: onWidgetSurfacePointerUp,
      onPointerCancel: onWidgetSurfacePointerCancel,
    },
    toggleWinSession,
    sessions,
    browserTabs,
    browserProfileGroups,
  };
}
