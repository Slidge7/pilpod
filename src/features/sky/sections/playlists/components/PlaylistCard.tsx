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
    <article className={`sky-pl${live ? " sky-pl--live" : ""}`}>
      <button
        type="button"
        className="sky-pl__open"
        onClick={() => onOpen(playlist.id)}
        aria-label={`Open ${playlist.name}`}
      />
      <div className="sky-pl__cover">
        <Cover artworks={summary.artworks} name={playlist.name} emoji={playlist.emoji} />
        {count > 0 ? (
          <button
            type="button"
            className="sky-pl__play"
            onClick={() => onPlay(playlist.id)}
            disabled={starting}
            title={`Play ${playlist.name}`}
            aria-label={`Play ${playlist.name}`}
          >
            {starting ? <Spinner /> : <IconPlay />}
          </button>
        ) : null}
        {live ? (
          <span className="sky-pill sky-pill--playing sky-pl__live">
            <span className="sky-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            Now playing
          </span>
        ) : null}
      </div>
      <h3 className="sky-pl__name">
        {playlist.emoji ? <span aria-hidden="true">{playlist.emoji} </span> : null}
        {playlist.name}
      </h3>
      <p className="sky-pl__meta">
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
