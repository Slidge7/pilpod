import "./WindowsSessionRow.css";
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

  const rowClass = [
    "pilpod-win-session-row",
    playing ? "pilpod-win-session-row--playing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const playClass = [
    "pilpod-win-session-row__play",
    playing ? "pilpod-win-session-row__play--playing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={rowClass}>
      <div className="pilpod-win-session-row__thumb">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="pilpod-win-session-row__thumb-img"
          />
        ) : (
          <div className="pilpod-win-session-row__thumb-placeholder">—</div>
        )}
      </div>
      <div className="pilpod-win-session-row__body">
        <p className="pilpod-win-session-row__title">
          {session.title?.trim() || "Unknown title"}
        </p>
        {(ch ?? dur) ? (
          <div className="pilpod-win-session-row__meta">
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
        className={playClass}
      >
        {busy ? (
          <Spinner />
        ) : playing ? (
          <IconPause className="pilpod-icon--sm" />
        ) : (
          <IconPlay className="pilpod-icon--sm" />
        )}
      </button>
    </li>
  );
}
