import { memo, useEffect, useState } from "react";
import type { AudioSessionInfoDto } from "../../../types/media";
import { IconVolume, IconVolumeMuted } from "../../../shared/ui/icons";
import { useThrottled } from "../ui/useThrottled";

/**
 * A browser's volume in the Windows mixer — the whole app, every tab. Drag
 * to change it; the value follows the mixer when it changes elsewhere.
 */
function MixerVolumeView({
  audio,
  label,
  onChange,
}: {
  audio: AudioSessionInfoDto;
  label: string;
  onChange: (instanceId: string, volume: number) => void;
}) {
  const reported = Math.round(audio.volume * 100);
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? reported;
  useEffect(() => {
    if (draft !== null && reported === draft) setDraft(null);
  }, [reported, draft]);
  const push = useThrottled((v: number) => onChange(audio.instanceId, v / 100), 60);

  return (
    <label className="sky-mixer" title={`${label} in the Windows mixer${audio.muted ? " (muted)" : ""}`}>
      {audio.muted ? <IconVolumeMuted /> : <IconVolume />}
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label={`${label} volume in the Windows mixer`}
        aria-valuetext={`${value}%`}
        style={{ "--sky-vol": `${value}%` } as React.CSSProperties}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDraft(v);
          push(v);
        }}
      />
      <span className="sky-mixer__value">{value}%</span>
    </label>
  );
}

export const MixerVolume = memo(MixerVolumeView);
