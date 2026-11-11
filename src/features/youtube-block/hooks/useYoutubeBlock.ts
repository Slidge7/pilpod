import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { youtubeBlockApi } from "../api";
import {
  EVT_YOUTUBE_BLOCK_CHANGED,
  type ClearScope,
  type YoutubeBlockState,
} from "../types";

const EMPTY: YoutubeBlockState = { blocked: [], history: [] };

export interface YoutubeBlockApi {
  state: YoutubeBlockState;
  /** The first snapshot has arrived. */
  loaded: boolean;
  unblock: (videoId: string) => Promise<void>;
  clearHistory: (scope: ClearScope) => Promise<void>;
}

/** The block list and its history, live: Rust pushes a snapshot on every change. */
export function useYoutubeBlock(): YoutubeBlockApi {
  const [state, setState] = useState<YoutubeBlockState>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    let unlisten: UnlistenFn | null = null;

    // Listen first, then read: a change between the two is never missed.
    listen<YoutubeBlockState>(EVT_YOUTUBE_BLOCK_CHANGED, (e) => {
      if (alive) setState(e.payload);
    })
      .then((fn) => {
        if (alive) unlisten = fn;
        else fn();
      })
      .catch((err: unknown) => console.error("[youtube-block] listen:", err));

    youtubeBlockApi
      .getState()
      .then((s) => {
        if (!alive) return;
        setState(s);
        setLoaded(true);
      })
      .catch((err: unknown) => console.error("[youtube-block] state:", err));

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const unblock = useCallback(async (videoId: string) => {
    try {
      await youtubeBlockApi.remove(videoId);
    } catch (err) {
      console.error("[youtube-block] unblock:", err);
    }
  }, []);

  const clearHistory = useCallback(async (scope: ClearScope) => {
    try {
      await youtubeBlockApi.clearHistory(scope);
    } catch (err) {
      console.error("[youtube-block] clear history:", err);
    }
  }, []);

  return { state, loaded, unblock, clearHistory };
}
