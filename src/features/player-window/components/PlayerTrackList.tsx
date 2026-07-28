import { useEffect, useRef } from "react";
import { IconMusicNote } from "../../../shared/ui/icons";
import { formatDuration } from "../../media-dashboard/lib/browserMedia";
import type { MediaItem, Playlist } from "../../vault/types";
import { useTrackDrag } from "../hooks/useTrackDrag";
import { PlayerTrackMenu } from "./PlayerTrackMenu";

/**
 * The playlist itself: one row per track, the playing one highlighted and
 * scrolled into view. Rows drag to reorder (the neighbours slide out of the way
 * as the row passes them), click to play, and carry a menu to remove them or
 * move/copy them into another playlist.
 *
 * Reordering commits the whole id list once, on release — the vault's
 * `reorderPlaylist` contract — never per pointer move.
 */
export function PlayerTrackList({
  items,
  currentItemId,
  otherPlaylists,
  scrollRef,
  onPlayItem,
  onReorder,
  onRemove,
  onMove,
  onCopy,
}: {
  items: MediaItem[];
  currentItemId: string | null;
  otherPlaylists: Playlist[];
  /** The scrolling ancestor, so a drag near an edge can scroll the list. */
  scrollRef: React.RefObject<HTMLElement | null>;
  onPlayItem: (itemId: string) => void;
  onReorder: (itemIds: string[]) => void;
  onRemove: (item: MediaItem) => void;
  onMove: (item: MediaItem, playlistId: string) => void;
  onCopy: (item: MediaItem, playlistId: string) => void;
}) {
  const currentRef = useRef<HTMLLIElement | null>(null);

  const { drag, rowStyle, shouldSuppressClick, handlers } = useTrackDrag({
    count: items.length,
    scrollRef,
    onCommit: (from, to) => {
      const ids = items.map((m) => m.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      onReorder(ids);
    },
  });

  useEffect(() => {
    // Never yank the list around underneath a drag.
    if (!drag) currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentItemId, drag]);

  if (items.length === 0) {
    return (
      <div className="pilpod-pw-empty">
        <IconMusicNote />
        <span>This playlist is empty.</span>
      </div>
    );
  }

  return (
    <ul className="pilpod-pw-list">
      {items.map((item, i) => {
        const title = item.mediaTitle?.trim() || item.pageTitle?.trim() || item.url;
        const art = item.artworkUrl?.trim() || null;
        const isCurrent = item.id === currentItemId;
        const isDragging = drag?.id === item.id;
        return (
          <li
            key={item.id}
            ref={isCurrent ? currentRef : undefined}
            className={[
              "pilpod-pw-row",
              isCurrent ? "pilpod-pw-row--current" : "",
              isDragging ? "pilpod-pw-row--dragging" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={rowStyle(i)}
            onPointerDown={(e) => handlers.onPointerDown(e, i, item.id)}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerCancel}
          >
            <span className="pilpod-pw-row__grip" aria-hidden title="Drag to reorder">
              ⠿
            </span>
            <button
              type="button"
              className="pilpod-pw-row__btn"
              title={`Play ${title}`}
              onClick={() => {
                if (shouldSuppressClick()) return;
                onPlayItem(item.id);
              }}
            >
              <span className="pilpod-pw-row__index" aria-hidden>
                {isCurrent ? <IconMusicNote className="pilpod-icon--sm" /> : i + 1}
              </span>
              <span className="pilpod-pw-row__thumb" aria-hidden>
                {art ? (
                  <img src={art} alt="" loading="lazy" decoding="async" draggable={false} />
                ) : (
                  <span className="pilpod-pw-row__thumb-letter">
                    {title.trim().charAt(0).toUpperCase() || "♪"}
                  </span>
                )}
              </span>
              <span className="pilpod-pw-row__text">
                <span className="pilpod-pw-row__title">{title}</span>
                {item.artist?.trim() ? (
                  <span className="pilpod-pw-row__artist">{item.artist}</span>
                ) : null}
              </span>
              <span className="pilpod-pw-row__time">
                {item.durationSecs ? formatDuration(item.durationSecs) : ""}
              </span>
            </button>
            <PlayerTrackMenu
              playlists={otherPlaylists}
              onRemove={() => onRemove(item)}
              onMove={(playlistId) => onMove(item, playlistId)}
              onCopy={(playlistId) => onCopy(item, playlistId)}
            />
          </li>
        );
      })}
    </ul>
  );
}
