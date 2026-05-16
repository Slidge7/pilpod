import type { MediaSessionDto } from "../../../types/media";
import { sessionDurationLabel } from "../lib/format";
import {
  channelSession,
  isSessionPlaying,
  thumbSrc,
} from "../lib/windowsMedia";
import { AppVolumeSlider } from "./AppVolumeSlider";
import { IconPause, IconPlay, Spinner } from "./icons";

type Props = {
  session: MediaSessionDto;
  busy: boolean;
  disabled: boolean;
  onPlayPause: (s: MediaSessionDto) => void;
  onMixerVolume: (instanceId: string, volume: number) => void;
};

const iconSm = "h-3 w-3";

export function WindowsSessionRow({
  session,
  busy,
  disabled,
  onPlayPause,
  onMixerVolume,
}: Props) {
  const playing = isSessionPlaying(session);
  const ch = channelSession(session);
  const dur = sessionDurationLabel(session);
  const thumbnail = thumbSrc(session);

  return (
    <li
      className={`flex items-center gap-2 px-2 py-1 transition-colors ${
        playing
          ? "bg-emerald-50/85 dark:bg-emerald-950/18"
          : "bg-transparent hover:bg-zinc-50/90 dark:hover:bg-zinc-900/55"
      }`}
    >
      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-sm bg-zinc-100 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-500 dark:text-zinc-600">
            —
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium leading-none text-[12px] text-zinc-900 dark:text-zinc-100">
          {session.title?.trim() || "Unknown title"}
        </p>
        {(ch ?? dur) ? (
          <div className="truncate pt-px text-[10px] leading-snug text-zinc-600 dark:text-zinc-500">
            {[ch, dur].filter(Boolean).join(" | ")}
          </div>
        ) : null}
      </div>
      {session.audio ? (
        <AppVolumeSlider
          ariaLabel={`Volume for ${session.title?.trim() || "media"}`}
          audio={session.audio}
          onVolumeChange={onMixerVolume}
        />
      ) : null}
      <button
        type="button"
        disabled={disabled}
        title={playing ? "Pause" : "Play"}
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => void onPlayPause(session)}
        className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-sm border disabled:cursor-not-allowed disabled:opacity-45 ${
          playing
            ? "border-emerald-600 bg-emerald-600 text-white hover:border-emerald-700 hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            : "border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        }`}
      >
        {busy ? (
          <Spinner />
        ) : playing ? (
          <IconPause className={iconSm} />
        ) : (
          <IconPlay className={iconSm} />
        )}
      </button>
    </li>
  );
}
