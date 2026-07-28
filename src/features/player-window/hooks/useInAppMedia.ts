import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { INAPP_BROWSER_ID } from "../../playlist-player/types";
import { IDLE_MEDIA, INAPP_MEDIA_EVENT, type InAppMedia } from "../types";

/** The player's synthetic tab id (mirrors `inapp_player::state::INAPP_TAB_ID`). */
const INAPP_TAB_ID = 1;

/** Cheap structural equality — a re-read that changed nothing must be a no-op. */
function same(a: InAppMedia, b: InAppMedia): boolean {
  return (
    a.active === b.active &&
    a.loading === b.loading &&
    a.url === b.url &&
    a.title === b.title &&
    a.artist === b.artist &&
    a.artworkUrl === b.artworkUrl &&
    a.playbackState === b.playbackState &&
    a.duration === b.duration &&
    a.currentTime === b.currentTime &&
    a.volume === b.volume &&
    a.muted === b.muted &&
    a.canSeek === b.canSeek
  );
}

/**
 * Live media state of the video stage, plus the playback controls.
 *
 * The agent reports about once a second — every message costs a cancelled
 * navigation in the site's page, so the channel is deliberately quiet. The seek
 * bar stays smooth because the last reported position is advanced locally
 * between reports; a report carrying a *new* position resets that clock, a
 * re-read carrying the same one deliberately does not.
 */
export function useInAppMedia() {
  const [media, setMedia] = useState<InAppMedia>(IDLE_MEDIA);
  const last = useRef<InAppMedia>(IDLE_MEDIA);
  const reportedAt = useRef(0);
  const alive = useRef(true);

  const apply = useCallback((next: InAppMedia) => {
    const prev = last.current;
    if (same(prev, next)) return;
    if (prev.currentTime !== next.currentTime || prev.playbackState !== next.playbackState) {
      reportedAt.current = Date.now();
    }
    last.current = next;
    setMedia(next);
  }, []);

  /** Local, optimistic edit (scrubbing, volume) — no round trip to wait for. */
  const patch = useCallback((fields: Partial<InAppMedia>) => {
    const next = { ...last.current, ...fields };
    if (fields.currentTime != null) reportedAt.current = Date.now();
    last.current = next;
    setMedia(next);
  }, []);

  useEffect(() => {
    alive.current = true;
    const unlisten: Promise<UnlistenFn> = listen<InAppMedia>(
      INAPP_MEDIA_EVENT,
      (e) => {
        if (alive.current && e.payload) apply(e.payload);
      },
    );

    const read = () =>
      invoke<InAppMedia>("inapp_get_media")
        .then((data) => {
          if (alive.current && data) apply(data);
        })
        .catch(() => {});

    void read();
    // Belt and braces: one tiny command a second so the UI can never sit stale
    // because an event did not arrive.
    const timer = window.setInterval(read, 1000);

    return () => {
      alive.current = false;
      window.clearInterval(timer);
      void unlisten.then((fn) => fn());
    };
  }, [apply]);

  // Local clock, only while something is actually playing.
  const [tick, setTick] = useState(0);
  const playing = media.playbackState === "playing";
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [playing]);

  const position = useMemo(() => {
    if (!playing) return media.currentTime;
    void tick;
    const next = media.currentTime + (Date.now() - reportedAt.current) / 1000;
    return media.duration > 0 ? Math.min(next, media.duration) : next;
  }, [playing, media.currentTime, media.duration, tick]);

  const control = useCallback(
    (action: string, value?: number) =>
      invoke("browser_media_control", {
        browserId: INAPP_BROWSER_ID,
        tabId: INAPP_TAB_ID,
        action,
        value: value ?? null,
      }).catch(() => {}),
    [],
  );

  const playPause = useCallback(() => {
    // Optimistic flip: the stage confirms within a second.
    patch({
      playbackState: last.current.playbackState === "playing" ? "paused" : "playing",
    });
    return control("playPause");
  }, [control, patch]);

  const seek = useCallback(
    (secs: number) => {
      patch({ currentTime: secs });
      return control("seek", secs);
    },
    [control, patch],
  );

  const setVolume = useCallback(
    (pct: number) => {
      patch({ volume: pct, muted: pct <= 0 });
      return control("setTabVolume", pct);
    },
    [control, patch],
  );

  const toggleMute = useCallback(() => {
    const next = !last.current.muted;
    patch({ muted: next });
    return control("muteTab", next ? 1 : 0);
  }, [control, patch]);

  return { media, position, playing, playPause, seek, setVolume, toggleMute };
}

export type InAppMediaApi = ReturnType<typeof useInAppMedia>;
