import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  IDLE_PLAYER_STATE,
  PLAYER_EVENTS,
  playerErrorMessage,
  type PlayerStateDto,
  type RepeatMode,
} from "../types";

export interface StartOptions {
  shuffle?: boolean;
  repeat?: RepeatMode;
  autoPlay?: boolean;
}

/**
 * The single stateful playlist-player hook (pattern: `useVault`). Rust owns
 * the session; this hydrates via `player_get_state`, then trusts
 * `player://update`. Mount once (MediaDashboard) and pass down.
 */
export function usePlaylistPlayer() {
  const [player, setPlayer] = useState<PlayerStateDto>(IDLE_PLAYER_STATE);
  const [lastError, setLastError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const unlisten: Promise<UnlistenFn> = listen<PlayerStateDto>(
      PLAYER_EVENTS.update,
      (e) => {
        if (alive.current && e.payload) setPlayer(e.payload);
      },
    );

    invoke<PlayerStateDto>("player_get_state")
      .then((data) => {
        if (alive.current && data) setPlayer(data);
      })
      .catch(() => {});

    return () => {
      alive.current = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  const run = useCallback(async (cmd: string, args?: Record<string, unknown>) => {
    try {
      await invoke(cmd, args);
      setLastError(null);
      return true;
    } catch (err) {
      setLastError(playerErrorMessage(String(err)));
      return false;
    }
  }, []);

  const start = useCallback(
    (playlistId: string, browserId: string, opts?: StartOptions) =>
      run("player_start", {
        playlistId,
        browserId,
        shuffle: opts?.shuffle ?? null,
        repeat: opts?.repeat ?? null,
        autoPlay: opts?.autoPlay ?? null,
      }),
    [run],
  );

  const stop = useCallback(
    (closeTab: boolean) => run("player_stop", { closeTab }),
    [run],
  );

  const next = useCallback(() => run("player_next"), [run]);
  const prev = useCallback(() => run("player_prev"), [run]);

  const playItem = useCallback(
    (itemId: string) => run("player_play_item", { itemId }),
    [run],
  );

  const setModes = useCallback(
    (modes: { repeat?: RepeatMode; shuffle?: boolean; autoPlay?: boolean }) =>
      run("player_set_modes", {
        repeat: modes.repeat ?? null,
        shuffle: modes.shuffle ?? null,
        autoPlay: modes.autoPlay ?? null,
      }),
    [run],
  );

  const clearError = useCallback(() => setLastError(null), []);

  return {
    player,
    lastError,
    clearError,
    start,
    stop,
    next,
    prev,
    playItem,
    setModes,
  };
}

export type PlaylistPlayerApi = ReturnType<typeof usePlaylistPlayer>;
