import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AudioSessionInfoDto,
  GsmtcSnapshot,
  MediaSessionDto,
} from "../../../types/media";
import { GSMTC_INIT_ERROR_EVENT, GSMTC_UPDATE_EVENT } from "../constants";
import { winRowKey } from "../lib/windowsMedia";

/**
 * Self-contained hook that owns the entire Windows media (GSMTC) lifecycle:
 *  - Subscribes to `gsmtc://update` and `gsmtc://init-error` Tauri events
 *  - Issues `gsmtc_refresh` on mount (with exponential retries)
 *  - Exposes play/pause and mixer-volume actions with per-session pending state
 *  - Also surfaces `browserAudio` from the snapshot (WASAPI data for browser volumes)
 *
 * No GSMTC logic lives outside this hook.
 */
export function useWindowsSessions() {
  const [sessions, setSessions] = useState<MediaSessionDto[]>([]);
  const [browserAudio, setBrowserAudio] = useState<
    Record<string, AudioSessionInfoDto>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(
    () => new Set(),
  );

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

  const applySnapshot = useCallback((snap: GsmtcSnapshot) => {
    setSessions(snap.sessions);
    setBrowserAudio(snap.browserAudio ?? {});
    setError(null);
  }, []);

  const refresh = useCallback(
    async (retries = 12): Promise<void> => {
      try {
        const snap = await invoke<GsmtcSnapshot>("gsmtc_refresh");
        applySnapshot(snap);
      } catch (e) {
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 120));
          return refresh(retries - 1);
        }
        setError(String(e));
      }
    },
    [applySnapshot],
  );

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let unlistenInitError: UnlistenFn | undefined;

    void listen<GsmtcSnapshot>(GSMTC_UPDATE_EVENT, (ev) => {
      applySnapshot(ev.payload);
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
  }, [applySnapshot, refresh]);

  /** Toggle play/pause for a Windows GSMTC session. */
  const toggleSession = useCallback(
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

  /** Set WASAPI volume for an app linked to a Windows session. */
  const setMixerVolume = useCallback(
    async (instanceId: string, volume: number) => {
      setError(null);
      try {
        await invoke("mixer_set_volume", { instanceId, volume });
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  return {
    sessions,
    browserAudio,
    error,
    pendingKeys,
    refresh,
    toggleSession,
    setMixerVolume,
  };
}
