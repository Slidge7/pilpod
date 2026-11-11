import { memo, useState, type ReactNode } from "react";
import type { MediaPlay, PageVisit } from "../types";
import { formatClock, formatDuration, hostOf } from "../lib/format";
import { IconMusicNote, IconOpenInTab, IconTrash } from "../../../shared/ui/icons";

export interface RowActions {
  onOpen: (url: string) => void;
  onRemove: (id: number) => void;
  /** Current icon for an OS browser id, when that browser is detected now. */
  iconFor: (osBrowserId: string) => string | null;
}

/**
 * `pilpod-vault-row` is the app's shared glass-row surface (styled in
 * `shared/ui/glass-*.css`, reused by the playlist player too); everything
 * inside the row is History's own layout.
 */
const ROW_SURFACE = "pilpod-vault-row pilpod-history-row";

/** Favicon or artwork that degrades to a neutral tile if the image fails. */
function Thumb({
  src,
  fallback,
  variant,
}: {
  src?: string | null;
  fallback: ReactNode;
  /** Icons render small and uncropped; artwork fills the tile. */
  variant: "icon" | "art";
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`pilpod-history-row__thumb pilpod-history-row__thumb--${variant}`} aria-hidden>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        fallback
      )}
    </div>
  );
}

/** The browser's icon when it is detected now; its recorded name otherwise. */
function BrowserTag({ name, icon }: { name: string; icon: string | null }) {
  return (
    <span className="pilpod-history-row__browser" title={name}>
      {icon ? <img src={icon} alt={name} width={12} height={12} /> : name}
    </span>
  );
}

function RowButtons({ url, id, label, actions }: { url: string; id: number; label: string; actions: RowActions }) {
  return (
    <div className="pilpod-history-row__actions">
      <button
        type="button"
        className="pilpod-history-iconbtn"
        title="Open"
        aria-label={`Open ${label}`}
        onClick={() => actions.onOpen(url)}
      >
        <IconOpenInTab />
      </button>
      <button
        type="button"
        className="pilpod-history-iconbtn pilpod-history-iconbtn--danger"
        title="Remove from history"
        aria-label={`Remove ${label} from history`}
        onClick={() => actions.onRemove(id)}
      >
        <IconTrash />
      </button>
    </div>
  );
}

/** "14:05 · 12m" for finished rows, "14:05 · open now" for live ones. */
function when(startedAtMs: number, endedAtMs: number | null | undefined, liveLabel: string): string {
  const clock = formatClock(startedAtMs);
  return endedAtMs == null ? `${clock} · ${liveLabel}` : `${clock} · ${formatDuration(endedAtMs - startedAtMs)}`;
}

export const PageVisitRow = memo(function PageVisitRow({
  visit,
  actions,
}: {
  visit: PageVisit;
  actions: RowActions;
}) {
  const host = hostOf(visit.url);
  const title = visit.title.trim() || host;
  const live = visit.endedAtMs == null;
  return (
    <li className={ROW_SURFACE}>
      <div className="pilpod-history-row__main">
        <Thumb
          variant="icon"
          src={visit.faviconUrl}
          fallback={<span className="pilpod-history-row__letter">{host.charAt(0).toUpperCase()}</span>}
        />
        <button
          type="button"
          className="pilpod-history-row__body"
          title={visit.url}
          onClick={() => actions.onOpen(visit.url)}
        >
          <span className="pilpod-history-row__title">
            {live ? <span className="pilpod-history-live" aria-label="Open now" /> : null}
            {title}
          </span>
          <span className="pilpod-history-row__meta">
            <span className="pilpod-history-row__host">{host}</span>
            <span className="pilpod-history-row__when">{when(visit.startedAtMs, visit.endedAtMs, "open now")}</span>
            <BrowserTag name={visit.browserName} icon={actions.iconFor(visit.osBrowserId)} />
          </span>
        </button>
        <RowButtons url={visit.url} id={visit.id} label={title} actions={actions} />
      </div>
    </li>
  );
});

export const MediaPlayRow = memo(function MediaPlayRow({
  play,
  actions,
}: {
  play: MediaPlay;
  actions: RowActions;
}) {
  const live = play.endedAtMs == null;
  const subtitle = play.artist?.trim() || hostOf(play.url);
  return (
    <li className={ROW_SURFACE}>
      <div className="pilpod-history-row__main">
        <Thumb variant="art" src={play.artworkUrl} fallback={<IconMusicNote className="pilpod-icon--sm" />} />
        <button
          type="button"
          className="pilpod-history-row__body"
          title={play.pageTitle || play.url}
          onClick={() => actions.onOpen(play.url)}
        >
          <span className="pilpod-history-row__title">
            {live ? <span className="pilpod-history-live" aria-label="Still loaded" /> : null}
            {play.title}
          </span>
          <span className="pilpod-history-row__meta">
            <span className="pilpod-history-row__host">{subtitle}</span>
            <span className="pilpod-history-row__when">
              {formatClock(play.startedAtMs)} · {formatDuration(play.playedMs)} played
            </span>
            <BrowserTag name={play.browserName} icon={actions.iconFor(play.osBrowserId)} />
          </span>
        </button>
        <RowButtons url={play.url} id={play.id} label={play.title} actions={actions} />
      </div>
    </li>
  );
});
