import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaItem, Playlist } from "../../../../vault";
import { IconChevronRight, IconPencil, IconPlus } from "../../../../../shared/ui/icons";
import { useTrackDrag } from "../../../../player-window";
import { useRename } from "../../../ui/InlineCreate";
import { Popover, usePopover } from "../../../ui/Popover";
import { AddFromTabsPanel } from "./AddFromTabsPanel";
import { ConfirmButton } from "../../../ui/ConfirmButton";
import { EmptyState } from "../../../ui/EmptyState";
import { formatTotal, plural, timeAgo } from "../../../ui/format";
import { moveItem, trackMatches, type PlaylistSummary } from "../lib/playlistView";
import { Cover } from "./Cover";
import { PlayButton, type TargetOption } from "./PlayButton";
import { TrackRow, type TrackActions, type TrackDrag } from "./TrackRow";
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
  onRename: (name: string) => Promise<boolean>;
  /** New order of the playlist's item ids. */
  onReorder: (itemIds: string[]) => void;
  trackActions: TrackActions;
};

const ADD_SIZE = { width: 420, height: 440 };

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
  onRename,
  onReorder,
  trackActions,
}: Props) {
  const rename = useRename(playlist.name, onRename);
  const add = usePopover(ADD_SIZE);

  // Show a new order the moment it is dropped; the vault's broadcast confirms it.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const savedIds = useMemo(() => summary.tracks.map((t) => t.id), [summary.tracks]);
  useEffect(() => {
    if (pendingOrder && pendingOrder.join("\n") === savedIds.join("\n")) setPendingOrder(null);
  }, [pendingOrder, savedIds]);
  const tracks = useMemo(() => {
    if (!pendingOrder) return summary.tracks;
    const byId = new Map(summary.tracks.map((t) => [t.id, t]));
    return pendingOrder.map((id) => byId.get(id)).filter((t): t is MediaItem => t != null);
  }, [pendingOrder, summary.tracks]);
  const ids = useMemo(() => tracks.map((t) => t.id), [tracks]);
  const reorder = (next: string[]) => {
    setPendingOrder(next);
    onReorder(next);
  };
  const sortable = terms.length === 0 && summary.tracks.length > 1;

  // The section body scrolls; a drag near its edge scrolls it.
  const listRef = useRef<HTMLOListElement>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    scrollRef.current = listRef.current?.closest<HTMLElement>(".sky-view__body") ?? null;
  });
  const drag = useTrackDrag({
    count: ids.length,
    scrollRef,
    onCommit: (from, to) => reorder(moveItem(ids, from, to)),
  });

  const rows = useMemo(
    () =>
      tracks
        .map((item: MediaItem, i) => ({ item, position: i + 1 }))
        .filter(({ item }) => trackMatches(item, terms)),
    [tracks, terms],
  );
  const length = formatTotal(summary.totalSecs);

  return (
    <div className="sky-pldetail">
      <nav className="sky-crumbs" aria-label="Breadcrumb">
        <button type="button" className="sky-link" onClick={onBack}>
          All playlists
        </button>
        <IconChevronRight className="sky-crumbs__sep" />
        <span aria-current="page">{playlist.name}</span>
      </nav>

      <header className={`sky-plhero${live ? " sky-plhero--live" : ""}`}>
        <Cover artworks={summary.artworks} name={playlist.name} emoji={playlist.emoji} size="lg" />
        <div className="sky-plhero__text">
          <h2 className="sky-plhero__name">
            {rename.input ?? (
              <>
                {playlist.emoji ? <span aria-hidden="true">{playlist.emoji} </span> : null}
                {playlist.name}
                <button
                  type="button"
                  className="sky-icon-btn sky-plhero__rename"
                  title="Rename playlist"
                  aria-label="Rename playlist"
                  onClick={rename.start}
                >
                  <IconPencil />
                </button>
              </>
            )}
          </h2>
          <p className="sky-plhero__meta">
            {[plural(summary.tracks.length, "track"), length, `updated ${timeAgo(playlist.updatedAtMs)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="sky-plhero__actions">
            <PlayButton
              disabled={summary.tracks.length === 0}
              busy={starting}
              target={target}
              options={targetOptions}
              onTarget={onTarget}
              onPlay={onPlay}
            />
            <button
              ref={add.anchorRef}
              type="button"
              className="sky-btn"
              aria-haspopup="dialog"
              aria-expanded={add.open}
              onClick={add.toggle}
            >
              <IconPlus />
              Add from open tabs
            </button>
            <Popover {...add} width={ADD_SIZE.width} label={`Add media to ${playlist.name}`}>
              <AddFromTabsPanel playlist={playlist} />
            </Popover>
            <ConfirmButton
              className="sky-textbtn sky-textbtn--danger"
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
        <ol ref={listRef} className="sky-tracks" aria-label={`Tracks in ${playlist.name}`}>
          {rows.map(({ item, position }) => {
            const index = position - 1;
            const rowDrag: TrackDrag | undefined = sortable
              ? {
                  style: drag.rowStyle(index),
                  dragging: drag.drag?.id === item.id,
                  onPointerDown: (e) => {
                    // Only the grip starts a drag; the rest of the row stays clickable.
                    if ((e.target as HTMLElement).closest(".sky-track__grip")) {
                      drag.handlers.onPointerDown(e, index, item.id);
                    }
                  },
                  onPointerMove: drag.handlers.onPointerMove,
                  onPointerUp: drag.handlers.onPointerUp,
                  onPointerCancel: drag.handlers.onPointerCancel,
                  onGripKey: (e) => {
                    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                    e.preventDefault();
                    const to = index + (e.key === "ArrowUp" ? -1 : 1);
                    if (to >= 0 && to < ids.length) reorder(moveItem(ids, index, to));
                  },
                }
              : undefined;
            return (
              <TrackRow
                key={item.id}
                item={item}
                position={position}
                current={live && item.id === currentItemId}
                terms={terms}
                actions={trackActions}
                drag={rowDrag}
              />
            );
          })}
        </ol>
      )}
    </div>
  );
}
