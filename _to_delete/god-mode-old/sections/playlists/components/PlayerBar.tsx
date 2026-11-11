import type { MediaItem, Playlist } from "../../../../vault";
import { playerErrorMessage } from "../../../../playlist-player";
import { IconSkipBack, IconSkipForward, IconStop } from "../../../../../shared/ui/icons";
import { usePlayer } from "../../../data/GodModeData";
import { Thumb } from "../../../ui/Thumb";
import { trackTitle } from "../lib/playlistView";

/**
 * The live playlist session, wherever it plays: what is on, where, and the
 * transport. Shown above the Playlists views while a session is active.
 */
export function PlayerBar({
  playlist,
  current,
  onOpenPlaylist,
}: {
  playlist: Playlist | null;
  current: MediaItem | null;
  onOpenPlaylist: (id: string) => void;
}) {
  const { player, next, prev, stop, lastError, clearError } = usePlayer();

  if (!player.active) {
    return lastError ? (
      <div className="gm-alert gm-alert--inline" role="alert">
        <span>{lastError}</span>
        <button type="button" className="gm-btn gm-btn--ghost" onClick={clearError}>
          Dismiss
        </button>
      </div>
    ) : null;
  }

  const where = player.target === "inApp" ? "in PilPod" : "in a browser tab";
  const status =
    player.status === "opening"
      ? `Opening ${player.target === "inApp" ? "the player window" : "the player tab"}…`
      : player.status === "ended"
        ? "Playlist ended"
        : player.status === "error"
          ? playerErrorMessage(player.error ?? "error")
          : `Track ${player.trackNumber} of ${player.totalTracks} ${where}`;

  return (
    <section className="gm-playerbar" aria-label="Now playing">
      <Thumb
        src={current?.artworkUrl}
        glyph={playlist?.emoji || "♪"}
        hueKey={playlist?.name ?? "player"}
        kind="art"
        className="gm-playerbar__art"
      />
      <div className="gm-playerbar__text">
        <p className="gm-playerbar__title">{current ? trackTitle(current) : "Starting…"}</p>
        <p className={`gm-playerbar__status${player.status === "error" ? " is-error" : ""}`}>
          {current?.artist ? `${current.artist} · ` : ""}
          {status}
          {playlist ? (
            <>
              {" · "}
              <button type="button" className="gm-link" onClick={() => onOpenPlaylist(playlist.id)}>
                {playlist.name}
              </button>
            </>
          ) : null}
        </p>
      </div>
      <div className="gm-playerbar__controls">
        <button type="button" className="gm-icon-btn gm-icon-btn--lg" title="Previous track" aria-label="Previous track" onClick={() => void prev()}>
          <IconSkipBack />
        </button>
        <button type="button" className="gm-icon-btn gm-icon-btn--lg" title="Next track" aria-label="Next track" onClick={() => void next()}>
          <IconSkipForward />
        </button>
        <button type="button" className="gm-icon-btn gm-icon-btn--lg gm-icon-btn--danger" title="Stop playlist" aria-label="Stop playlist" onClick={() => void stop(true)}>
          <IconStop />
        </button>
      </div>
    </section>
  );
}
