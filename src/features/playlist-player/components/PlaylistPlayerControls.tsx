import { useMemo, useState } from "react";
import "../PlaylistPlayer.css";
import type { DetectedBrowser } from "../../../types/media";
import type { Playlist } from "../../vault/types";
import {
  IconPlay,
  IconSkipBack,
  IconSkipForward,
  IconStop,
  Spinner,
} from "../../../shared/ui/icons";
import type { PlaylistPlayerApi, StartTarget } from "../hooks/usePlaylistPlayer";
import { INAPP_BROWSER_ID, playerErrorMessage, type RepeatMode } from "../types";
import { PlayerModeButtons } from "./PlayerModeButtons";

/** Sentinel value for the in-app option in the target picker. */
const IN_APP_VALUE = "inapp";

/** `"inapp"` | `"b:<browserId>"` → the union the hook expects. */
function toStartTarget(value: string): StartTarget {
  return value === IN_APP_VALUE
    ? { target: "inApp" }
    : { target: "browser", browserId: value.slice(2) };
}

/**
 * Playback control bar for one playlist (rendered in the playlist detail
 * page): browser picker → Play, then transport + modes + live status while
 * this playlist is the active session.
 */
export function PlaylistPlayerControls({
  playlist,
  browsers,
  api,
}: {
  playlist: Playlist;
  browsers: DetectedBrowser[];
  api: PlaylistPlayerApi;
}) {
  const { player } = api;
  const isThis = player.active && player.playlistId === playlist.id;
  const isOtherActive = player.active && !isThis;

  // Real browsers only: the in-app player rides the list as a media source, but
  // it is the dedicated "In PilPod" option here, never a browser choice.
  const eligible = useMemo(
    () => browsers.filter((b) => b.extensionConnected && b.id !== INAPP_BROWSER_ID),
    [browsers],
  );

  // Playing in the app needs nothing external, so it is both the default and
  // always available — a browser is only one of the options now.
  const [pickedTarget, setPickedTarget] = useState<string>(IN_APP_VALUE);
  const [starting, setStarting] = useState(false);
  // Pre-start mode choices; once the session is live these mirror Rust state.
  const [localRepeat, setLocalRepeat] = useState<RepeatMode>("off");
  const [localShuffle, setLocalShuffle] = useState(false);
  const [localAutoPlay, setLocalAutoPlay] = useState(true);

  // A browser that disconnects while selected falls back to the in-app player
  // rather than leaving the picker pointing at nothing.
  const targetValue =
    pickedTarget !== IN_APP_VALUE && !eligible.some((b) => `b:${b.id}` === pickedTarget)
      ? IN_APP_VALUE
      : pickedTarget;

  const repeat = isThis ? player.repeat : localRepeat;
  const shuffle = isThis ? player.shuffle : localShuffle;
  const autoPlay = isThis ? player.autoPlay : localAutoPlay;

  const handleRepeat = (mode: RepeatMode) =>
    isThis ? void api.setModes({ repeat: mode }) : setLocalRepeat(mode);
  const handleShuffle = (on: boolean) =>
    isThis ? void api.setModes({ shuffle: on }) : setLocalShuffle(on);
  const handleAutoPlay = (on: boolean) =>
    isThis ? void api.setModes({ autoPlay: on }) : setLocalAutoPlay(on);

  const handlePlay = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await api.start(playlist.id, toStartTarget(targetValue), {
        repeat: localRepeat,
        shuffle: localShuffle,
        autoPlay: localAutoPlay,
      });
    } finally {
      setStarting(false);
    }
  };

  const status = !isThis
    ? null
    : player.status === "opening"
      ? player.target === "inApp"
        ? "Opening player window…"
        : "Opening player tab…"
      : player.status === "ended"
        ? "Playlist ended"
        : player.status === "error"
          ? playerErrorMessage(player.error ?? "error")
          : `Track ${player.trackNumber} of ${player.totalTracks}`;

  const disabled = playlist.itemIds.length === 0;

  return (
    <div
      className={[
        "pilpod-player-controls",
        isThis ? "pilpod-player-controls--live" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="pilpod-player-controls__row">
        {!isThis ? (
          <>
            <select
              className="pilpod-player-controls__browser"
              value={targetValue}
              aria-label="Where to play"
              onChange={(e) => setPickedTarget(e.target.value)}
            >
              <option value={IN_APP_VALUE}>In PilPod</option>
              {eligible.map((b) => (
                <option key={b.id} value={`b:${b.id}`}>
                  {b.profileLabel ?? b.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="pilpod-player-controls__play"
              disabled={disabled || starting}
              title={
                disabled
                  ? "Add items to this playlist to play it"
                  : targetValue === IN_APP_VALUE
                    ? "Play in a PilPod player window"
                    : `Play in ${
                        eligible.find((b) => `b:${b.id}` === targetValue)?.displayName ??
                        "browser"
                      }`
              }
              onClick={() => void handlePlay()}
            >
              {starting ? <Spinner /> : <IconPlay className="pilpod-icon--sm" />}
              <span>Play</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="pilpod-player-mode-btn"
              title="Previous track"
              aria-label="Previous track"
              onClick={() => void api.prev()}
            >
              <IconSkipBack className="pilpod-icon--sm" />
            </button>
            <button
              type="button"
              className="pilpod-player-mode-btn"
              title="Next track"
              aria-label="Next track"
              onClick={() => void api.next()}
            >
              <IconSkipForward className="pilpod-icon--sm" />
            </button>
            <button
              type="button"
              className="pilpod-player-controls__stop"
              title={
                player.target === "inApp"
                  ? "Stop and close the player window"
                  : "Stop and close the player tab"
              }
              aria-label="Stop playlist"
              onClick={() => void api.stop(true)}
            >
              <IconStop className="pilpod-icon--sm" />
              <span>Stop</span>
            </button>
          </>
        )}

        <span className="pilpod-player-controls__spacer" />

        <PlayerModeButtons
          repeat={repeat}
          shuffle={shuffle}
          autoPlay={autoPlay}
          onRepeatChange={handleRepeat}
          onShuffleChange={handleShuffle}
          onAutoPlayChange={handleAutoPlay}
        />
      </div>

      {status ? (
        <div
          className={[
            "pilpod-player-controls__status",
            player.status === "error" ? "pilpod-player-controls__status--error" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-live="polite"
        >
          {isThis && player.status === "ready" ? (
            <span className="pilpod-player-controls__live-dot" aria-hidden />
          ) : null}
          {status}
        </div>
      ) : api.lastError ? (
        <div className="pilpod-player-controls__status pilpod-player-controls__status--error">
          {api.lastError}
        </div>
      ) : isOtherActive ? (
        <div className="pilpod-player-controls__status">
          Another playlist is playing — pressing Play switches to this one.
        </div>
      ) : null}
    </div>
  );
}
