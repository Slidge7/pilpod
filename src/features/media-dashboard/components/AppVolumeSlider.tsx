import type { AudioSessionInfoDto } from "../../../types/media";

type Props = {
  ariaLabel: string;
  audio: AudioSessionInfoDto;
  disabled?: boolean;
  /** Called while dragging so the UI feels responsive; backend emits new snapshot after each invoke. */
  onVolumeChange: (instanceId: string, volume: number) => void;
};

export function AppVolumeSlider({
  ariaLabel,
  audio,
  disabled,
  onVolumeChange,
}: Props) {
  const pct = Math.round(audio.volume * 100);

  return (
    <div
      className="flex shrink-0 items-center gap-1.5"
      title={
        audio.muted
          ? `${ariaLabel} — muted (${pct}%)`
          : `${ariaLabel} — ${pct}%`
      }
    >
      <span
        className="w-6 shrink-0 text-center font-medium tabular-nums text-[9px] leading-none text-zinc-500 dark:text-zinc-500"
        aria-hidden
      >
        {audio.muted ? "M" : pct}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.02}
        value={audio.volume}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          onVolumeChange(audio.instanceId, Math.min(1, Math.max(0, v)));
        }}
        className="h-1 w-[72px] cursor-pointer appearance-none rounded-full bg-zinc-200 accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-zinc-800 dark:accent-emerald-500 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-1.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-sm [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-emerald-600 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-1.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-emerald-600"
      />
    </div>
  );
}
