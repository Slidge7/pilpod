import { memo, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { MediaItem } from "../../../../vault";
import { IconGrip, IconOpenInTab, IconPlay, IconTrash } from "../../../../../shared/ui/icons";
import { Highlight } from "../../../search/components/Highlight";
import { hostOf } from "../../../search/lib/text";
import { formatLength } from "../../../ui/format";
import { Thumb } from "../../../ui/Thumb";
import { useConfirm } from "../../../ui/useConfirm";
import { trackTitle } from "../lib/playlistView";

export type TrackActions = {
  play: (item: MediaItem) => void;
  open: (item: MediaItem) => void;
  remove: (item: MediaItem) => void;
};

/** Reordering hooks for a row; absent while the list is filtered. */
export type TrackDrag = {
  style: CSSProperties | undefined;
  dragging: boolean;
  onPointerDown: (e: PointerEvent<HTMLLIElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLLIElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLLIElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLLIElement>) => void;
  /** Arrow keys on the grip move the track one place. */
  onGripKey: (e: KeyboardEvent<HTMLButtonElement>) => void;
};

type Props = {
  item: MediaItem;
  position: number;
  current: boolean;
  terms: readonly string[];
  actions: TrackActions;
  drag?: TrackDrag;
};

function TrackRowView({ item, position, current, terms, actions, drag }: Props) {
  const title = trackTitle(item);
  const host = hostOf(item.url) ?? "";
  const remove = useConfirm(() => actions.remove(item));
  return (
    <li
      className={[
        "sky-track",
        current ? "sky-track--current" : "",
        drag ? "sky-track--sortable" : "",
        drag?.dragging ? "sky-track--dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-current={current ? "true" : undefined}
      style={drag?.style}
      onPointerDown={drag?.onPointerDown}
      onPointerMove={drag?.onPointerMove}
      onPointerUp={drag?.onPointerUp}
      onPointerCancel={drag?.onPointerCancel}
    >
      {drag ? (
        <button
          type="button"
          className="sky-track__grip"
          title="Drag to reorder (or use the arrow keys)"
          aria-label={`Move “${title}”. Use the up and down arrow keys.`}
          onKeyDown={drag.onGripKey}
        >
          <IconGrip />
        </button>
      ) : null}
      <span className="sky-track__pos">
        {current ? (
          <span className="sky-eq" aria-label="Playing">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="sky-track__num">{position}</span>
        )}
        <button type="button" className="sky-track__playbtn" title={`Play from “${title}”`} aria-label={`Play from ${title}`} onClick={() => actions.play(item)}>
          <IconPlay />
        </button>
      </span>
      <Thumb src={item.artworkUrl} glyph="♪" hueKey={item.artist || host} kind="art" className="sky-track__art" />
      <span className="sky-track__text">
        <span className="sky-track__title">
          <Highlight text={title} terms={terms} />
        </span>
        <span className="sky-track__sub">
          <Highlight text={item.artist?.trim() || host} terms={terms} />
        </span>
      </span>
      <span className="sky-track__host">{item.artist ? host : ""}</span>
      <span className="sky-track__len">{formatLength(item.durationSecs) ?? ""}</span>
      <span className="sky-track__actions">
        <button type="button" className="sky-icon-btn" title="Open in a browser" aria-label="Open in a browser" onClick={() => actions.open(item)}>
          <IconOpenInTab />
        </button>
        <button
          type="button"
          className={`sky-icon-btn sky-icon-btn--danger${remove.armed ? " is-armed" : ""}`}
          title={remove.armed ? "Press again to remove" : "Remove from playlist"}
          aria-label={remove.armed ? "Press again to remove" : "Remove from playlist"}
          onClick={remove.press}
        >
          {remove.armed ? "Remove?" : <IconTrash />}
        </button>
      </span>
    </li>
  );
}

export const TrackRow = memo(TrackRowView);
