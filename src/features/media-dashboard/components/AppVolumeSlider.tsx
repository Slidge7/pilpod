import "./AppVolumeSlider.css";
import { useEffect, useRef, useState } from "react";
import type { AudioSessionInfoDto } from "../../../types/media";

type Props = {
  ariaLabel: string;
  audio: AudioSessionInfoDto;
  disabled?: boolean;
  onVolumeChange: (instanceId: string, volume: number) => void;
};

export function AppVolumeSlider({
  ariaLabel,
  audio,
  disabled,
  onVolumeChange,
}: Props) {
  const [localVolume, setLocalVolume] = useState(audio.volume);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalVolume(audio.volume);
  }, [audio.volume]);

  const pct = Math.round(localVolume * 100);

  return (
    <div
      className="pilpod-volume"
      title={
        audio.muted
          ? `${ariaLabel} — muted (${pct}%)`
          : `${ariaLabel} — ${pct}%`
      }
    >
      <span className="pilpod-volume__pct" aria-hidden>
        {audio.muted ? "M" : pct}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.02}
        value={localVolume}
        disabled={disabled}
        className="pilpod-volume__range"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          const clamped = Math.min(1, Math.max(0, v));
          setLocalVolume(clamped);
          if (timerRef.current !== null) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            onVolumeChange(audio.instanceId, clamped);
          }, 30);
        }}
      />
    </div>
  );
}
