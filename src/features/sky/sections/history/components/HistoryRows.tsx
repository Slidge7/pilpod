import { memo } from "react";
import {
  formatClock,
  formatDuration,
  type MediaPlay,
  type PageVisit,
} from "../../../../history";
import { faviconFromUrl } from "../../../../media-dashboard";
import { IconOpenInTab, IconTrash } from "../../../../../shared/ui/icons";
import { hostOf } from "../../../search/lib/text";
import { Highlight } from "../../../search/components/Highlight";
import { Thumb } from "../../../ui/Thumb";
import { formatLength } from "../../../ui/format";

export type HistoryRowActions = {
  open: (url: string) => void;
  remove: (id: number) => void;
  iconFor: (osBrowserId: string) => string | null;
};

function BrowserMark({ name, icon }: { name: string; icon: string | null }) {
  return (
    <span className="sky-hrow__browser" title={name}>
      {icon ? (
        <img src={icon} alt={name} width={14} height={14} />
      ) : (
        <span className="sky-hrow__browser-letter" aria-label={name}>
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
    </span>
  );
}

function RowActions({ label, url, id, actions }: { label: string; url: string; id: number; actions: HistoryRowActions }) {
  return (
    <span className="sky-hrow__actions">
      <button
        type="button"
        className="sky-icon-btn"
        title="Open"
        aria-label={`Open ${label}`}
        onClick={() => actions.open(url)}
      >
        <IconOpenInTab />
      </button>
      <button
        type="button"
        className="sky-icon-btn sky-icon-btn--danger"
        title="Remove from history"
        aria-label={`Remove ${label} from history`}
        onClick={() => actions.remove(id)}
      >
        <IconTrash />
      </button>
    </span>
  );
}

type PageProps = { visit: PageVisit; terms: readonly string[]; actions: HistoryRowActions };

export const PageRow = memo(function PageRow({ visit, terms, actions }: PageProps) {
  const host = hostOf(visit.url) ?? visit.url;
  const title = visit.title.trim() || host;
  const open = visit.endedAtMs == null;
  return (
    <li className="sky-hrow">
      <time className="sky-hrow__time" dateTime={new Date(visit.startedAtMs).toISOString()}>
        {formatClock(visit.startedAtMs)}
      </time>
      <Thumb src={visit.faviconUrl || faviconFromUrl(visit.url)} glyph={host.charAt(0).toUpperCase()} hueKey={host} />
      <button type="button" className="sky-hrow__main" title={visit.url} onClick={() => actions.open(visit.url)}>
        <span className="sky-hrow__title">
          <Highlight text={title} terms={terms} />
        </span>
        <span className="sky-hrow__sub">
          <Highlight text={host} terms={terms} />
        </span>
      </button>
      <span className={`sky-hrow__span${open ? " sky-hrow__span--live" : ""}`}>
        {open ? "Open now" : formatDuration((visit.endedAtMs ?? visit.startedAtMs) - visit.startedAtMs)}
      </span>
      <BrowserMark name={visit.browserName} icon={actions.iconFor(visit.osBrowserId)} />
      <RowActions label={title} url={visit.url} id={visit.id} actions={actions} />
    </li>
  );
});

type PlayProps = { play: MediaPlay; terms: readonly string[]; actions: HistoryRowActions };

export const PlayRow = memo(function PlayRow({ play, terms, actions }: PlayProps) {
  const host = hostOf(play.url) ?? play.url;
  const title = play.title.trim() || play.pageTitle.trim() || host;
  const length = formatLength(play.durationSecs);
  const loaded = play.endedAtMs == null;
  return (
    <li className="sky-hrow sky-hrow--media">
      <time className="sky-hrow__time" dateTime={new Date(play.startedAtMs).toISOString()}>
        {formatClock(play.startedAtMs)}
      </time>
      <Thumb src={play.artworkUrl} glyph="♪" hueKey={play.artist || host} kind="art" className="sky-hrow__art" />
      <button type="button" className="sky-hrow__main" title={play.pageTitle || play.url} onClick={() => actions.open(play.url)}>
        <span className="sky-hrow__title">
          <Highlight text={title} terms={terms} />
        </span>
        <span className="sky-hrow__sub">
          <Highlight text={[play.artist?.trim(), host].filter(Boolean).join(" · ")} terms={terms} />
        </span>
      </button>
      <span className={`sky-hrow__span${loaded ? " sky-hrow__span--live" : ""}`} title="Time spent playing">
        {formatDuration(play.playedMs)}
        {length ? <small> of {length}</small> : null}
      </span>
      <BrowserMark name={play.browserName} icon={actions.iconFor(play.osBrowserId)} />
      <RowActions label={title} url={play.url} id={play.id} actions={actions} />
    </li>
  );
});
