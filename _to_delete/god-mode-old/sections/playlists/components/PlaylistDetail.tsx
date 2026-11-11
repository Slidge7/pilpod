import { useMemo } from "react";
import type { MediaItem, Playlist } from "../../../../vault";
import { IconChevronRight } from "../../../../../shared/ui/icons";
import { ConfirmButton } from "../../../ui/ConfirmButton";
import { EmptyState } from "../../../ui/EmptyState";
import { formatTotal, plural, timeAgo } from "../../../ui/format";
import { trackMatches, type PlaylistSummary } from "../lib/playlistView";
import { Cover } from "./Cover";
import { PlayButton, type TargetOption } from "./PlayButton";
import { TrackRow, type TrackActions } from "./TrackRow";
import type { PlayTarget } from "../usePlaylistActions";

type Props = {
  playlist: Playlist;
  summary: PlaylistSummary;
  terms: readonly string[];
  live: boolean;
  currentItemId: string | null;
  starting: boolean;
  target: PlayTarget;
  targetOptions: readonly TargetOption[];
  onTarget: (target: PlayTarget) => void;
  onPlay: (shuffle: boolean) => void;
  onBack: () => void;
  onDelete: () => void;
  trackActions: TrackActions;
};

/** One playlist: its cover and play controls, then the track list. */
export function PlaylistDetail({
  playlist,
  summary,
  terms,
  live,
  currentItemId,
  starting,
  target,
  targetOptions,
  onTarget,
  onPlay,
  onBack,
  onDelete,
  trackActions,
}: Props) {
  const rows = useMemo(
    () =>
      summary.tracks
        .map((item: MediaItem, i) => ({ item, position: i + 1 }))
        .filter(({ item }) => trackMatches(item, terms)),
    [summary.tracks, terms],
  );
  const length = formatTotal(summary.totalSecs);

  return (
    <div className="gm-pldetail">
      <nav className="gm-crumbs" aria-label="Breadcrumb">
        <button type="button" className="gm-link" onClick={onBack}>
          All playlists
        </button>
        <IconChevronRight className="gm-crumbs__sep" />
        <span aria-current="page">{playlist.name}</span>
      </nav>

      <header className={`gm-plhero${live ? " gm-plhero--live" : ""}`}>
        <Cover artworks={summary.artworks} name={playlist.name} emoji={playlist.emoji} size="lg" />
        <div className="gm-plhero__text">
          <h2 className="gm-plhero__name">
            {playlist.emoji ? <span aria-hidden="true">{playlist.emoji} </span> : null}
            {playlist.name}
          </h2>
          <p className="gm-plhero__meta">
            {[plural(summary.tracks.length, "track"), length, `updated ${timeAgo(playlist.updatedAtMs)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="gm-plhero__actions">
            <PlayButton
              disabled={summary.tracks.length === 0}
              busy={starting}
              target={target}
              options={targetOptions}
              onTarget={onTarget}
              onPlay={onPlay}
            />
            <ConfirmButton
              className="gm-textbtn gm-textbtn--danger"
              confirmLabel="Delete this playlist?"
              title="Delete the playlist (its tracks stay in other playlists)"
              onConfirm={onDelete}
            >
              Delete playlist
            </ConfirmButton>
          </div>
        </div>
      </header>

      {summary.tracks.length === 0 ? (
        <EmptyState title="This playlist is empty">
          Add videos or music from a tab’s save menu in the dashboard, and they appear here.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="No track matches">No track in this playlist fits the filter.</EmptyState>
      ) : (
        <ol className="gm-tracks" aria-label={`Tracks in ${playlist.name}`}>
          {rows.map(({ item, position }) => (
            <TrackRow
              key={item.id}
              item={item}
              position={position}
              current={live && item.id === currentItemId}
              terms={terms}
              actions={trackActions}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
