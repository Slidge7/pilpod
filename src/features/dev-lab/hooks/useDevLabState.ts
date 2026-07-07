import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BrowsersUpdatePayload,
  DetectedBrowser,
} from "../../../types/media";
import type { DevFullState, DevWakeAndSyncResult } from "../types";
import {
  actionEntry,
  appendLog,
  diffBrowsersPayload,
  type DevLogEntry,
} from "../lib/eventLog";

const BROWSERS_UPDATE_EVENT = "browsers://update";

/**
 * Dev Lab v2 state: full diagnostic snapshot + live event log + all actions.
 *
 * - `full` is fetched on demand (`refreshFull`) — it runs an OS scan.
 * - `browsers://update` events patch `full.merged` live and feed the log.
 */
export function useDevLabState() {
  const [full, setFull] = useState<DevFullState | null>(null);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<DevLogEntry[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const prevBrowsersRef = useRef<DetectedBrowser[] | null>(null);

  const pushLog = useCallback((entries: DevLogEntry[]) => {
    setLog((prev) => appendLog(prev, entries));
  }, []);

  const logAction = useCallback(
    (subject: string, message: string, isError = false) => {
      pushLog([actionEntry(subject, message, isError)]);
    },
    [pushLog],
  );

  const refreshFull = useCallback(async () => {
    setLoading(true);
    try {
      const state = await invoke<DevFullState>("dev_get_full_state");
      setFull(state);
      const entries = diffBrowsersPayload(
        prevBrowsersRef.current,
        state.merged.browsers,
      );
      prevBrowsersRef.current = state.merged.browsers;
      pushLog(entries);
    } catch (e) {
      logAction("dev_get_full_state", String(e), true);
    } finally {
      setLoading(false);
    }
  }, [pushLog, logAction]);

  // Live: merged payload updates + event-log diffing.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<BrowsersUpdatePayload>(BROWSERS_UPDATE_EVENT, (ev) => {
      const entries = diffBrowsersPayload(
        prevBrowsersRef.current,
        ev.payload.browsers,
      );
      prevBrowsersRef.current = ev.payload.browsers;
      pushLog(entries);
      setFull((prev) => (prev ? { ...prev, merged: ev.payload } : prev));
    }).then((fn) => {
      unlisten = fn;
    });
    void refreshFull();
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withBusy = useCallback(
    async (id: string, fn: () => Promise<void>) => {
      setBusyIds((prev) => new Set(prev).add(id));
      try {
        await fn();
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [],
  );

  // ── Actions ────────────────────────────────────────────────────────────────

  const wakeAndSync = useCallback(
    (osBrowserId: string) =>
      withBusy(osBrowserId, async () => {
        logAction(osBrowserId, "wake & sync requested");
        try {
          const r = await invoke<DevWakeAndSyncResult>(
            "dev_wake_and_sync_browser",
            { osBrowserId },
          );
          const summary = r.error
            ? r.error
            : `connected=${r.connected} launched=${r.launched} wait=${r.waitMs}ms`;
          logAction(osBrowserId, `wake & sync: ${summary}`, Boolean(r.error));
        } catch (e) {
          logAction(osBrowserId, `wake & sync failed: ${String(e)}`, true);
        }
        await refreshFull();
      }),
    [withBusy, logAction, refreshFull],
  );

  const killWs = useCallback(
    async (browserId: string, subject: string) => {
      try {
        const had = await invoke<boolean>("dev_kill_ws", { browserId });
        logAction(
          subject,
          had ? "WS session killed (simulated drop)" : "no live WS session",
          !had,
        );
      } catch (e) {
        logAction(subject, `kill WS failed: ${String(e)}`, true);
      }
    },
    [logAction],
  );

  const clearExtInstalled = useCallback(
    async (osBrowserId: string) => {
      try {
        const cleared = await invoke<boolean>("dev_clear_ext_installed", {
          osBrowserId,
        });
        logAction(
          osBrowserId,
          cleared ? "extension-installed flag cleared" : "flag was not set",
          !cleared,
        );
      } catch (e) {
        logAction(osBrowserId, `clear flag failed: ${String(e)}`, true);
      }
      await refreshFull();
    },
    [logAction, refreshFull],
  );

  const clearIconCache = useCallback(async () => {
    try {
      await invoke("dev_clear_icon_cache");
      logAction("icons", "icon cache cleared");
    } catch (e) {
      logAction("icons", `clear icon cache failed: ${String(e)}`, true);
    }
    await refreshFull();
  }, [logAction, refreshFull]);

  const syncAll = useCallback(async () => {
    try {
      await invoke("request_browser_sync");
      logAction("all", "full resync requested from every connected browser");
    } catch (e) {
      logAction("all", `sync failed: ${String(e)}`, true);
    }
  }, [logAction]);

  const mediaControl = useCallback(
    async (
      browserId: string,
      tabId: number,
      action: string,
      subject: string,
      value?: number,
    ) => {
      try {
        await invoke("browser_media_control", {
          browserId,
          tabId,
          action,
          value: value ?? null,
          tabTitleForFocus: null,
          browserWindowHint: null,
        });
        logAction(subject, `${action} → tab ${tabId}`);
      } catch (e) {
        logAction(subject, `${action} failed: ${String(e)}`, true);
      }
    },
    [logAction],
  );

  // ── Phase 5 scenario actions ───────────────────────────────────────────────

  const injectStaleSlot = useCallback(
    async (osBrowserId: string) => {
      try {
        const id = await invoke<string>("dev_inject_stale_slot", { osBrowserId });
        logAction(osBrowserId, `stale slot injected: ${id} (GC within ~2s, or press GC now)`);
      } catch (e) {
        logAction(osBrowserId, `inject stale failed: ${String(e)}`, true);
      }
      await refreshFull();
    },
    [logAction, refreshFull],
  );

  const gcSlotsNow = useCallback(async () => {
    try {
      const removed = await invoke<string[]>("dev_gc_slots_now");
      logAction(
        "gc",
        removed.length
          ? `removed ${removed.length} stale slot(s): ${removed.join(", ")}`
          : "nothing stale to remove",
      );
    } catch (e) {
      logAction("gc", `gc failed: ${String(e)}`, true);
    }
    await refreshFull();
  }, [logAction, refreshFull]);

  const simulateResume = useCallback(async () => {
    try {
      const n = await invoke<number>("dev_simulate_resume");
      logAction("resume", `simulated system resume — ${n} slot(s) marked reconnecting`);
    } catch (e) {
      logAction("resume", `simulate resume failed: ${String(e)}`, true);
    }
    await refreshFull();
  }, [logAction, refreshFull]);

  const clearLog = useCallback(() => setLog([]), []);

  return {
    full,
    loading,
    log,
    busyIds,
    refreshFull,
    wakeAndSync,
    killWs,
    clearExtInstalled,
    clearIconCache,
    syncAll,
    mediaControl,
    injectStaleSlot,
    gcSlotsNow,
    simulateResume,
    clearLog,
  };
}
