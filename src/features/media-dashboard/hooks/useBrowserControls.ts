import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BrowserTab, DetectedBrowser, WakeAndSyncBrowserResult } from "../../../types/media";
import { tabRowKey } from "../lib/browserMedia";

/**
 * Every media action PilPod can perform on a browser tab, plus the in-flight
 * bookkeeping the UI needs to show spinners.
 *
 * Extracted from `useMediaDashboard` because the floating widget renders the
 * same tab rows in its own window and needs the same behaviour. Two copies of
 * this logic would be two places to fix the next time an action gains an
 * argument, so both surfaces consume this hook instead.
 *
 * The hook is intentionally stateless about *which* browsers exist — the
 * caller passes its own list — so the widget can subscribe to the browser
 * stream independently without a shared provider.
 */

/** How long a pending action may stay pending before the spinner gives up. */
const PENDING_TTL_MS = 8_000;

export type BrowserControlsOptions = {
  /**
   * Runs before PilPod hands focus to a browser window. The dashboard uses it
   * to drop its own always-on-top so the browser can actually come forward;
   * the widget passes nothing, because a widget that un-pins itself to focus a
   * tab would vanish behind the browser it just raised.
   */
  onBeforeExternalFocus?: () => Promise<void> | void;
};

export type BrowserControls = ReturnType<typeof useBrowserControls>;

export function useBrowserControls(
  browsers: readonly DetectedBrowser[],
  options: BrowserControlsOptions = {},
) {
  const { onBeforeExternalFocus } = options;

  const [error, setError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // Keep the latest browsers/callback in refs so the bulk actions below are
  // stable identities. Without this, every browser poll would produce new
  // function props and re-render the whole tab tree for nothing.
  const browsersRef = useRef(browsers);
  browsersRef.current = browsers;
  const beforeFocusRef = useRef(onBeforeExternalFocus);
  beforeFocusRef.current = onBeforeExternalFocus;

  const timeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(
    () => () => {
      for (const id of timeouts.current.values()) clearTimeout(id);
      timeouts.current.clear();
    },
    [],
  );

  const clearPending = useCallback((key: string) => {
    const id = timeouts.current.get(key);
    if (id !== undefined) {
      clearTimeout(id);
      timeouts.current.delete(key);
    }
    setPendingKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const markPending = useCallback(
    (key: string) => {
      const existing = timeouts.current.get(key);
      if (existing !== undefined) clearTimeout(existing);
      // TTL watchdog: if the command never settles (IPC dropped, backend
      // panic) the row must not be stuck spinning for the whole session.
      timeouts.current.set(
        key,
        setTimeout(() => clearPending(key), PENDING_TTL_MS),
      );
      setPendingKeys((prev) => new Set(prev).add(key));
    },
    [clearPending],
  );

  /** One-shot control call with no pending indicator. */
  const control = useCallback(
    async (
      browserId: string,
      tabId: number,
      action: string,
      extra?: Record<string, unknown>,
    ) => {
      setError(null);
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId,
          action,
          ...extra,
        });
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  /** Control call that marks the row pending until it settles. */
  const controlPending = useCallback(
    async (
      tab: BrowserTab,
      browserId: string,
      action: string,
      extra?: Record<string, unknown>,
    ) => {
      const key = tabRowKey(tab);
      markPending(key);
      try {
        await control(browserId, tab.tabId, action, extra);
      } finally {
        clearPending(key);
      }
    },
    [clearPending, control, markPending],
  );

  const toggleTab = useCallback(
    (tab: BrowserTab, browserId: string) =>
      void controlPending(tab, browserId, "playPause"),
    [controlPending],
  );

  const reloadTab = useCallback(
    (tab: BrowserTab, browserId: string) =>
      controlPending(tab, browserId, "reloadTab"),
    [controlPending],
  );

  const closeTab = useCallback(
    (tab: BrowserTab, browserId: string) =>
      controlPending(tab, browserId, "closeTab"),
    [controlPending],
  );

  const reactivateTab = useCallback(
    (tab: BrowserTab, browserId: string) =>
      controlPending(tab, browserId, "reactivateTab"),
    [controlPending],
  );

  const focusTab = useCallback(
    async (tab: BrowserTab, browserId: string, browserDisplayName: string) => {
      await beforeFocusRef.current?.();
      await controlPending(tab, browserId, "focusTab", {
        tabTitleForFocus: tab.title?.trim() ?? "",
        browserWindowHint: browserDisplayName,
      });
    },
    [controlPending],
  );

  const seekTab = useCallback(
    (tab: BrowserTab, browserId: string, seekTo: number) =>
      void control(browserId, tab.tabId, "seek", { value: seekTo }),
    [control],
  );

  const setTabVolume = useCallback(
    (tab: BrowserTab, browserId: string, volume: number) =>
      void control(browserId, tab.tabId, "setTabVolume", { value: volume }),
    [control],
  );

  const resetTabVolume = useCallback(
    (tab: BrowserTab, browserId: string) =>
      void control(browserId, tab.tabId, "setTabVolume", { value: 100 }),
    [control],
  );

  const pip = useCallback(
    (tab: BrowserTab, browserId: string) =>
      void control(browserId, tab.tabId, "pip"),
    [control],
  );

  /**
   * Apply one action across every matching tab.
   *
   * Issued concurrently: these are independent IPC round-trips, and the old
   * sequential `await` in a nested loop made "mute everything" take
   * tab-count × round-trip before the last tab went quiet.
   */
  const forEachTab = useCallback(
    async (
      match: (tab: BrowserTab) => boolean,
      action: string,
      extra?: Record<string, unknown>,
    ) => {
      setError(null);
      const calls: Promise<unknown>[] = [];
      for (const browser of browsersRef.current) {
        for (const tab of browser.tabs) {
          if (!match(tab)) continue;
          calls.push(
            invoke("browser_media_control", {
              browserId: browser.id,
              tabId: tab.tabId,
              action,
              ...extra,
            }).catch(() => {
              /* best effort — one stubborn tab must not abort the sweep */
            }),
          );
        }
      }
      await Promise.all(calls);
    },
    [],
  );

  const pauseAll = useCallback(
    () => forEachTab((t) => t.media?.playbackState === "playing", "playPause"),
    [forEachTab],
  );

  const muteAll = useCallback(
    () => forEachTab((t) => Boolean(t.media), "muteTab", { value: 1 }),
    [forEachTab],
  );

  const resetAllVolumes = useCallback(
    () => forEachTab((t) => Boolean(t.media), "setTabVolume", { value: 100 }),
    [forEachTab],
  );

  const setMixerVolume = useCallback(
    async (instanceId: string, volume: number) => {
      try {
        await invoke("mixer_set_volume", { instanceId, volume });
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  const refreshConnection = useCallback(async (browserId: string) => {
    setError(null);
    try {
      const browser = browsersRef.current.find((b) => b.id === browserId);
      const osBrowserId = browser?.osBrowserId ?? browserId;
      const result = await invoke<WakeAndSyncBrowserResult>(
        "dev_wake_and_sync_browser",
        { osBrowserId },
      );
      if (result.error) {
        setError(result.error);
      } else if (result.timedOut) {
        setError(
          `Extension did not connect within ${Math.round(result.waitMs / 1000)}s`,
        );
      }
      return result;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  return {
    error,
    setError,
    pendingKeys,
    toggleTab,
    focusTab,
    reloadTab,
    closeTab,
    reactivateTab,
    seekTab,
    setTabVolume,
    resetTabVolume,
    pip,
    pauseAll,
    muteAll,
    resetAllVolumes,
    setMixerVolume,
    refreshConnection,
  };
}
