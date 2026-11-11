import { memo } from "react";
import type { MediaItem } from "../../../../vault";
import { IconOpenInTab, IconPlay, IconTrash } from "../../../../../shared/ui/icons";
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

type Props = {
  item: MediaItem;
  position: number;
  current: boolean;
  terms: readonly string[];
  actions: TrackActions;
};

function TrackRowView({ item, position, current, terms, actions }: Props) {
  const title = trackTitle(item);
  const host = hostOf(item.url) ?? "";
  const remove = useConfirm(() => actions.remove(item));
  return (
    <li className={`gm-track${current ? " gm-track--current" : ""}`} aria-current={current ? "true" : undefined}>
      <span className="gm-track__pos">
        {current ? (
          <span className="gm-eq" aria-label="Playing">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="gm-track__num">{position}</span>
        )}
        <button type="button" className="gm-track__playbtn" title={`Play from “${title}”`} aria-label={`Play from ${title}`} onClick={() => actions.play(item)}>
          <IconPlay />
        </button>
      </span>
      <Thumb src={item.artworkUrl} glyph="♪" hueKey={item.artist || host} kind="art" className="gm-track__art" />
      <span className="gm-track__text">
        <span className="gm-track__title">
          <Highlight text={title} terms={terms} />
        </span>
        <span className="gm-track__sub">
          <Highlight text={item.artist?.trim() || host} terms={terms} />
        </span>
      </span>
      <span className="gm-track__host">{item.artist ? host : ""}</span>
      <span className="gm-track__len">{formatLength(item.durationSecs) ?? ""}</span>
      <span className="gm-track__actions">
        <button type="button" className="gm-icon-btn" title="Open in a browser" aria-label="Open in a browser" onClick={() => actions.open(item)}>
          <IconOpenInTab />
        </button>
        <button
          type="button"
          className={`gm-icon-btn gm-icon-btn--danger${remove.armed ? " is-armed" : ""}`}
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
