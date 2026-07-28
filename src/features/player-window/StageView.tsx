import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "./StageView.css";

/**
 * The video stage — PilPod's own page inside the player window's stage webview.
 *
 * YouTube cannot be played by pointing a webview at it:
 *   * `m.youtube.com/watch` renders a thumbnail and an "Open App" bar, and
 *     creates no `<video>` element until the user taps it;
 *   * navigating straight to `/embed/<id>` fails with *Error 153*, because a
 *     top-level navigation carries no referrer and YouTube requires one.
 *
 * So the embed lives in an iframe on this page — a real referrer — and is
 * driven through YouTube's IFrame Player API, which gives exact play/pause,
 * seek, volume and an `ENDED` event. A transparent shield sits over the iframe
 * so the stage stays a display surface: PilPod's transport drives playback,
 * clicks never reach YouTube.
 *
 * Sites that are not YouTube never render here — the stage webview navigates to
 * their page instead, where the injected agent strips it down in place.
 */

type StageDto = { kind: string; videoId?: string; volume: number };
type StageCommand = { action: string; value: number | null };

/** Minimal shape of the bits of the IFrame API this file uses. */
type YtPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getDuration(): number;
  getCurrentTime(): number;
  getPlayerState(): number;
  getVideoData?: () => { title?: string; author?: string };
  loadVideoById(videoId: string): void;
  destroy(): void;
};

const REPORT_MS = 250;

/** Load the IFrame API once per document. */
function loadYouTubeApi(): Promise<any> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (w.__pilpodYtApi) return w.__pilpodYtApi as Promise<any>;

  w.__pilpodYtApi = new Promise((resolve) => {
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(w.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return w.__pilpodYtApi as Promise<any>;
}

export function StageView() {
  const [stage, setStage] = useState<StageDto>({ kind: "idle", volume: 100 });
  const [failed, setFailed] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const wantedVolume = useRef(100);

  // ── what should be on stage ───────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const unlisten: Promise<UnlistenFn> = listen<StageDto>("inapp://stage", (e) => {
      if (alive && e.payload) {
        setFailed(null);
        setStage(e.payload);
      }
    });
    invoke<StageDto>("inapp_stage_get")
      .then((s) => {
        if (alive && s) setStage(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  // ── the player ────────────────────────────────────────────────────────────
  useEffect(() => {
    const videoId = stage.kind === "youtube" ? stage.videoId : undefined;
    if (!videoId || !hostRef.current) return;
    wantedVolume.current = stage.volume;

    // Same player, next video: swapping the id keeps the API alive and skips a
    // full iframe reload.
    if (playerRef.current?.loadVideoById) {
      playerRef.current.loadVideoById(videoId);
      return;
    }

    let cancelled = false;
    void loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          origin: window.location.origin,
        },
        events: {
          onReady: (e: { target: YtPlayer }) => {
            // Sites mute themselves to satisfy autoplay policies; this window
            // exists to play sound.
            e.target.unMute();
            e.target.setVolume(Math.round(wantedVolume.current));
            e.target.playVideo();
          },
          onStateChange: (e: { data: number }) => {
            // 0 = ENDED. PilPod owns sequencing, so tell it and nothing else.
            if (e.data === 0) void invoke("inapp_stage_ended").catch(() => {});
          },
          onError: (e: { data: number }) => {
            // 101/150 = embedding disabled by the uploader.
            setFailed(
              e.data === 101 || e.data === 150
                ? "This video cannot be played inside an app."
                : `The video could not be loaded (error ${e.data}).`,
            );
          },
        },
      }) as YtPlayer;
    });

    return () => {
      cancelled = true;
    };
  }, [stage.kind, stage.videoId, stage.volume]);

  // ── report upstream ───────────────────────────────────────────────────────
  useEffect(() => {
    if (stage.kind !== "youtube") return;
    const timer = window.setInterval(() => {
      const p = playerRef.current;
      if (!p?.getPlayerState) return;
      let report;
      try {
        const state = p.getPlayerState();
        const data = p.getVideoData?.();
        report = {
          playbackState: state === 1 ? "playing" : state === -1 ? "none" : "paused",
          title: data?.title ?? "",
          artist: data?.author ?? "",
          artworkUrl: stage.videoId
            ? `https://i.ytimg.com/vi/${stage.videoId}/mqdefault.jpg`
            : "",
          duration: p.getDuration() || 0,
          currentTime: p.getCurrentTime() || 0,
          volume: p.isMuted() ? 0 : p.getVolume(),
          muted: p.isMuted(),
          hasMedia: state !== -1,
        };
      } catch {
        return; // the player is mid-swap; the next tick will do
      }
      void invoke("inapp_stage_report", { report }).catch(() => {});
    }, REPORT_MS);
    return () => window.clearInterval(timer);
  }, [stage.kind, stage.videoId]);

  // ── commands from PilPod ──────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const unlisten: Promise<UnlistenFn> = listen<StageCommand>("inapp://cmd", (e) => {
      const p = playerRef.current;
      if (!alive || !p || !e.payload) return;
      const { action, value } = e.payload;
      try {
        switch (action) {
          case "playPause":
            if (p.getPlayerState() === 1) p.pauseVideo();
            else p.playVideo();
            break;
          case "seek":
            if (value != null) p.seekTo(value, true);
            break;
          case "setTabVolume":
            if (value != null) {
              wantedVolume.current = value;
              p.setVolume(Math.max(0, Math.min(100, Math.round(value))));
              if (value > 0) p.unMute();
            }
            break;
          case "muteTab":
            if (value == null) (p.isMuted() ? p.unMute() : p.mute());
            else if (value >= 1) p.mute();
            else p.unMute();
            break;
          default:
            break;
        }
      } catch {
        /* a bad command must never break the stage */
      }
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="pilpod-stage">
      <div className="pilpod-stage__frame" ref={hostRef} />
      {/* Swallows every click: the stage is a display, not a page. */}
      <div className="pilpod-stage__shield" />
      {failed ? <div className="pilpod-stage__error">{failed}</div> : null}
      {stage.kind === "idle" && !failed ? (
        <div className="pilpod-stage__idle">
          <span className="pilpod-stage__spinner" />
        </div>
      ) : null}
    </div>
  );
}
