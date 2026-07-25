import {
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
} from "../../../shared/ui/icons";
import { nextRepeatMode, type RepeatMode } from "../types";

/**
 * The shared mode cluster: repeat (off → all → one), optional shuffle, and
 * auto-play. Pure/controlled — used by the playlist page controls and the
 * dashboard mini player card.
 */
export function PlayerModeButtons({
  repeat,
  autoPlay,
  shuffle,
  onRepeatChange,
  onAutoPlayChange,
  onShuffleChange,
  compact = false,
}: {
  repeat: RepeatMode;
  autoPlay: boolean;
  /** Omit to hide the shuffle button (mini card). */
  shuffle?: boolean;
  onRepeatChange: (mode: RepeatMode) => void;
  onAutoPlayChange: (on: boolean) => void;
  onShuffleChange?: (on: boolean) => void;
  compact?: boolean;
}) {
  const btn = (active: boolean) =>
    [
      "pilpod-player-mode-btn",
      compact ? "pilpod-player-mode-btn--compact" : "",
      active ? "pilpod-player-mode-btn--active" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const repeatTitle =
    repeat === "off"
      ? "Repeat: off — click for repeat all"
      : repeat === "all"
        ? "Repeat: all — click for repeat one"
        : "Repeat: one — click to turn off";

  return (
    <>
      {shuffle !== undefined && onShuffleChange ? (
        <button
          type="button"
          className={btn(shuffle)}
          title={shuffle ? "Shuffle: on" : "Shuffle: off"}
          aria-label="Toggle shuffle"
          aria-pressed={shuffle}
          onClick={() => onShuffleChange(!shuffle)}
        >
          <IconShuffle className="pilpod-icon--sm" />
        </button>
      ) : null}
      <button
        type="button"
        className={btn(repeat !== "off")}
        title={repeatTitle}
        aria-label={repeatTitle}
        onClick={() => onRepeatChange(nextRepeatMode(repeat))}
      >
        {repeat === "one" ? (
          <IconRepeatOne className="pilpod-icon--sm" />
        ) : (
          <IconRepeat className="pilpod-icon--sm" />
        )}
      </button>
      <button
        type="button"
        className={btn(autoPlay)}
        title={autoPlay ? "Auto-play next: on" : "Auto-play next: off"}
        aria-label="Toggle auto-play next"
        aria-pressed={autoPlay}
        onClick={() => onAutoPlayChange(!autoPlay)}
      >
        <span className="pilpod-player-mode-btn__text">auto</span>
      </button>
    </>
  );
}
