import { useCallback, useRef, useState } from "react";
import {
  IconPause,
  IconPlay,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconSkipBack,
  IconSkipForward,
  IconVolume,
  IconVolumeMuted,
} from "../../../shared/ui/icons";
import { volFillTone } from "../../../shared/ui/volumeScale";
import { formatDuration } from "../../media-dashboard/lib/browserMedia";
// The seek bar and volume slider are the media tab's, class for class — see
// the overrides in PlayerWindow.css, which only re-place them in the flow.
import "../../media-dashboard/components/MediaItemCard.css";
import { nextRepeatMode, type RepeatMode } from "../../playlist-player/types";
import type { InAppMediaApi } from "../hooks/useInAppMedia";

/**
 * Seek bar + transport + modes. Track sequencing (next/prev/repeat/shuffle) is
 * PilPod's; play/pause, seek and volume act on the video stage.
 */
export function PlayerTransport({
  api,
  repeat,
  shuffle,
  autoPlay,
  onNext,
  onPrev,
  onRepeat,
  onShuffle,
  onAutoPlay,
}: {
  api: InAppMediaApi;
  repeat: RepeatMode;
  shuffle: boolean;
  autoPlay: boolean;
  onNext: () => void;
  onPrev: () => void;
  onRepeat: (mode: RepeatMode) => void;
  onShuffle: (on: boolean) => void;
  onAutoPlay: (on: boolean) => void;
}) {
  const { media, position, playing } = api;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);

  const duration = media.duration > 0 ? media.duration : 0;
  const shown = seekPreview ?? position;
  const progress = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;
  const seekActive = duration > 0;

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || duration <= 0) return 0;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  const onSeekDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seekActive) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsSeeking(true);
    setSeekPreview(timeAt(e.clientX));
  };
  const onSeekMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSeeking) return;
    setSeekPreview(timeAt(e.clientX));
  };
  const onSeekUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSeeking) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const at = timeAt(e.clientX);
    setSeekPreview(null);
    setIsSeeking(false);
    void api.seek(at);
  };

  // ── volume ───────────────────────────────────────────────────────────────
  // Plain 0–100, unlike the media tab's boostable scale: the stage plays
  // through a player API whose own range is 0–100, so there is nothing above
  // 100 to give.
  const effectiveVolume = Math.min(100, Math.max(0, Math.round(media.muted ? 0 : media.volume)));
  const volTone = volFillTone(effectiveVolume);
  const volFraction = effectiveVolume / 100;
  const volClass = [
    "pilpod-media-item__vol-track",
    volTone !== "normal" ? `pilpod-media-item__vol-track--${volTone}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const volPctClass = [
    "pilpod-media-item__vol-pct",
    volTone !== "normal" ? `pilpod-media-item__vol-pct--${volTone}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="pilpod-pw-transport">
      <div className="pilpod-pw-seekbar">
        <span className="pilpod-pw-time">{formatDuration(Math.floor(shown))}</span>
        <div
          className={[
            "pilpod-media-item__seek-wrap",
            seekActive ? "pilpod-media-item__seek-wrap--active" : "",
            isSeeking ? "pilpod-media-item__seek-wrap--dragging" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.floor(duration))}
          aria-valuenow={Math.floor(shown)}
          tabIndex={0}
          onPointerDown={seekActive ? onSeekDown : undefined}
          onPointerMove={seekActive ? onSeekMove : undefined}
          onPointerUp={seekActive ? onSeekUp : undefined}
          onPointerCancel={seekActive ? onSeekUp : undefined}
        >
          <div className="pilpod-media-item__seek-track" ref={trackRef}>
            <div
              className={[
                "pilpod-media-item__seek-fill",
                playing ? "pilpod-media-item__seek-fill--playing" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <span className="pilpod-pw-time">
          {duration > 0 ? formatDuration(Math.floor(duration)) : "--:--"}
        </span>
      </div>

      <div className="pilpod-pw-buttons">
        <button
          type="button"
          className={`pilpod-pw-btn${shuffle ? " pilpod-pw-btn--on" : ""}`}
          title={shuffle ? "Shuffle: on" : "Shuffle: off"}
          aria-pressed={shuffle}
          onClick={() => onShuffle(!shuffle)}
        >
          <IconShuffle className="pilpod-icon--sm" />
        </button>

        <button type="button" className="pilpod-pw-btn" title="Previous track" onClick={onPrev}>
          <IconSkipBack className="pilpod-icon--sm" />
        </button>

        <button
          type="button"
          className="pilpod-pw-btn pilpod-pw-btn--primary"
          title={playing ? "Pause" : "Play"}
          onClick={() => void api.playPause()}
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>

        <button type="button" className="pilpod-pw-btn" title="Next track" onClick={onNext}>
          <IconSkipForward className="pilpod-icon--sm" />
        </button>

        <button
          type="button"
          className={`pilpod-pw-btn${repeat !== "off" ? " pilpod-pw-btn--on" : ""}`}
          title={`Repeat: ${repeat}`}
          onClick={() => onRepeat(nextRepeatMode(repeat))}
        >
          {repeat === "one" ? (
            <IconRepeatOne className="pilpod-icon--sm" />
          ) : (
            <IconRepeat className="pilpod-icon--sm" />
          )}
        </button>
      </div>

      <div className="pilpod-pw-secondary">
        <button
          type="button"
          className={`pilpod-pw-chip${autoPlay ? " pilpod-pw-chip--on" : ""}`}
          title="Auto-play the next track"
          aria-pressed={autoPlay}
          onClick={() => onAutoPlay(!autoPlay)}
        >
          auto
        </button>

        <div className="pilpod-media-item__vol-block pilpod-pw-volume">
          <button
            type="button"
            className="pilpod-media-item__vol-icon-btn"
            title={effectiveVolume === 0 ? "Unmute" : "Mute"}
            aria-label={effectiveVolume === 0 ? "Unmute" : "Mute"}
            onClick={() => void api.toggleMute()}
          >
            {effectiveVolume === 0 ? (
              <IconVolumeMuted className="pilpod-media-item__vol-icon-svg" />
            ) : (
              <IconVolume className="pilpod-media-item__vol-icon-svg" />
            )}
          </button>
          <span className="pilpod-media-item__vol-slider-wrap">
            <input
              type="range"
              className={volClass}
              min={0}
              max={100}
              step={1}
              value={effectiveVolume}
              style={{ "--vol-pct": `${volFraction * 100}%` } as React.CSSProperties}
              aria-label={`Volume: ${effectiveVolume}%`}
              onChange={(e) => void api.setVolume(Number(e.target.value))}
            />
          </span>
          <span className={volPctClass}>
            {media.muted ? "mute" : `${effectiveVolume}%`}
          </span>
        </div>
      </div>
    </div>
  );
}
