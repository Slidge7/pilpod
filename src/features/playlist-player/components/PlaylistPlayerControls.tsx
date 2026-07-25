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
import type { PlaylistPlayerApi } from "../hooks/usePlaylistPlayer";
import { playerErrorMessage, type RepeatMode } from "../types";
import { PlayerModeButtons } from "./PlayerModeButtons";

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

  const eligible = useMemo(
    () => browsers.filter((b) => b.extensionConnected),
    [browsers],
  );

  const [pickedBrowserId, setPickedBrowserId] = useState<string>("");
  const [starting, setStarting] = useState(false);
  // Pre-start mode choices; once the session is live these mirror Rust state.
  const [localRepeat, setLocalRepeat] = useState<RepeatMode>("off");
  const [localShuffle, setLocalShuffle] = useState(false);
  const [localAutoPlay, setLocalAutoPlay] = useState(true);

  const browserId =
    pickedBrowserId && eligible.some((b) => b.id === pickedBrowserId)
      ? pickedBrowserId
      : eligible[0]?.id ?? "";

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
    if (!browserId || starting) return;
    setStarting(true);
    try {
      await api.start(playlist.id, browserId, {
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
      ? "Opening player tab…"
      : player.status === "ended"
        ? "Playlist ended"
        : player.status === "error"
          ? playerErrorMessage(player.error ?? "error")
          : `Track ${player.trackNumber} of ${player.totalTracks}`;

  const disabled = playlist.itemIds.length === 0 || eligible.length === 0;

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
              value={browserId}
              aria-label="Browser to play in"
              disabled={eligible.length === 0}
              onChange={(e) => setPickedBrowserId(e.target.value)}
            >
              {eligible.length === 0 ? (
                <option value="">No connected browser</option>
              ) : (
                eligible.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.profileLabel ?? b.displayName}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              className="pilpod-player-controls__play"
              disabled={disabled || starting}
              title={
                disabled
                  ? "Add items and connect a browser to play"
                  : `Play in ${eligible.find((b) => b.id === browserId)?.displayName ?? "browser"}`
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
              title="Stop and close the player tab"
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
