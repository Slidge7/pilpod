import { memo } from "react";
import type { Playlist } from "../../../../vault";
import { IconPlay, Spinner } from "../../../../../shared/ui/icons";
import { formatTotal, plural } from "../../../ui/format";
import type { PlaylistSummary } from "../lib/playlistView";
import { Cover } from "./Cover";

type Props = {
  playlist: Playlist;
  summary: PlaylistSummary;
  /** Tracks matching the current filter, when one is active. */
  matching: number | null;
  live: boolean;
  starting: boolean;
  onOpen: (id: string) => void;
  onPlay: (id: string) => void;
};

function PlaylistCardView({ playlist, summary, matching, live, starting, onOpen, onPlay }: Props) {
  const count = summary.tracks.length;
  const length = formatTotal(summary.totalSecs);
  return (
    <article className={`gm-pl${live ? " gm-pl--live" : ""}`}>
      <button
        type="button"
        className="gm-pl__open"
        onClick={() => onOpen(playlist.id)}
        aria-label={`Open ${playlist.name}`}
      />
      <div className="gm-pl__cover">
        <Cover artworks={summary.artworks} name={playlist.name} emoji={playlist.emoji} />
        {count > 0 ? (
          <button
            type="button"
            className="gm-pl__play"
            onClick={() => onPlay(playlist.id)}
            disabled={starting}
            title={`Play ${playlist.name}`}
            aria-label={`Play ${playlist.name}`}
          >
            {starting ? <Spinner /> : <IconPlay />}
          </button>
        ) : null}
        {live ? (
          <span className="gm-pill gm-pill--playing gm-pl__live">
            <span className="gm-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            Now playing
          </span>
        ) : null}
      </div>
      <h3 className="gm-pl__name">
        {playlist.emoji ? <span aria-hidden="true">{playlist.emoji} </span> : null}
        {playlist.name}
      </h3>
      <p className="gm-pl__meta">
        {matching !== null
          ? `${plural(matching, "matching track")} of ${count}`
          : count === 0
            ? "Empty"
            : [plural(count, "track"), length].filter(Boolean).join(" · ")}
      </p>
    </article>
  );
}

export const PlaylistCard = memo(PlaylistCardView);
