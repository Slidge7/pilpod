import "./WindowsSessionRow.css";
import type { MediaSessionDto } from "../../../types/media";
import { AppVolumeSlider } from "../../../shared/ui/AppVolumeSlider";
import { IconPause, IconPlay, Spinner } from "../../../shared/ui/icons";
import { sessionDurationLabel } from "../lib/format";
import {
  channelSession,
  isSessionPlaying,
  thumbSrc,
} from "../lib/windowsMedia";

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

  const cardClass = [
    "pilpod-control-card",
    "pilpod-control-card--media",
    playing ? "pilpod-control-card--playing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const playClass = [
    "pilpod-control-card__play",
    playing ? "pilpod-control-card__play--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={cardClass}>
      <div className="pilpod-control-card__main">
        <div className="pilpod-control-card__thumb-wrap">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              className="pilpod-win-card__thumb-img"
            />
          ) : (
            <div className="pilpod-win-card__thumb-placeholder">—</div>
          )}
        </div>

        <div className="pilpod-control-card__body">
          <p className="pilpod-control-card__title-row">
            <span className="pilpod-control-card__title">
              {session.title?.trim() || "Unknown title"}
            </span>
          </p>
          {(ch ?? dur) ? (
            <p className="pilpod-control-card__meta">
              {[ch, dur].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>

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
      </div>

      {session.audio ? (
        <div className="pilpod-control-card__volume">
          <AppVolumeSlider
            ariaLabel={`Volume for ${session.title?.trim() || "media"}`}
            audio={session.audio}
            onVolumeChange={onMixerVolume}
          />
        </div>
      ) : null}
    </li>
  );
}
