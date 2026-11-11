import { memo } from "react";
import "./TabCard.css";
import type { BrowserTab } from "../../../../../types/media";
import {
  isTabPlaying,
  mediaArtist,
  mediaTimeLabel,
  tabHasMediaControls,
  tabSiteHost,
  useTabCloseConfirm,
} from "../../../../media-dashboard";
import {
  IconOpenInTab,
  IconPause,
  IconPin,
  IconPlay,
  IconReload,
  IconVolume,
  IconVolumeMuted,
  IconX,
  Spinner,
} from "../../../../../shared/ui/icons";
import type { TabCardActions } from "../useLiveOverview";
import {
  isTabMuted,
  mediaProgress,
  sameCardTab,
  tabLifecycle,
} from "../lib/tabCard";
import { TabThumbnail } from "./TabThumbnail";

type Props = {
  tab: BrowserTab;
  browserId: string;
  /** Profile / browser label — focus uses it to find the right OS window. */
  browserName: string;
  /** Show `browserName` on the card (Now Playing mixes browsers). */
  showBrowser?: boolean;
  /** This tab hosts the playlist session. */
  isPlayerTab?: boolean;
  busy: boolean;
  actions: TabCardActions;
};

const LIFECYCLE_LABEL = {
  sleeping: "Sleeping",
  loading: "Loading",
  crashed: "Crashed",
} as const;

function TabCardView({
  tab,
  browserId,
  browserName,
  showBrowser = false,
  isPlayerTab = false,
  busy,
  actions,
}: Props) {
  const media = tab.media ?? null;
  const playing = isTabPlaying(tab);
  const controllable = tabHasMediaControls(tab);
  const muted = isTabMuted(tab);
  const lifecycle = tabLifecycle(tab.tabState);
  const progress = mediaProgress(tab);
  const time = media ? mediaTimeLabel(media) : null;

  const host = tabSiteHost(tab);
  const title = tab.title?.trim() || media?.title?.trim() || host || tab.url;
  const artist = media ? mediaArtist(media) : null;
  const meta = [artist, host].filter(Boolean).join(" · ");

  const { closeConfirm, handleClose, closeTitle } = useTabCloseConfirm({
    onClose: () => actions.close(tab, browserId),
  });

  const status = playing
    ? { tone: "playing", label: "Playing" }
    : controllable
      ? { tone: "paused", label: "Paused" }
      : lifecycle
        ? { tone: lifecycle, label: LIFECYCLE_LABEL[lifecycle] }
        : null;

  const cardClass = [
    "gm-card",
    playing ? "gm-card--playing" : "",
    tab.active ? "gm-card--active" : "",
    lifecycle === "sleeping" ? "gm-card--sleeping" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClass} aria-busy={busy}>
      {/*
        Stretched over the whole card (see TabCard.css) so the picture and the
        text are one big "show this tab" target, while the action row sits
        above it. Content stays outside the button: headings are not valid
        inside one.
      */}
      <button
        type="button"
        className="gm-card__open"
        onClick={() => actions.focus(tab, browserId, browserName)}
        title={`${title}\n${tab.url}`}
        aria-label={`Show “${title}” in ${browserName}`}
      />

      <div className="gm-card__media">
        <TabThumbnail tab={tab} />

        <div className="gm-card__badges">
          {status ? (
            <span className={`gm-pill gm-pill--${status.tone}`}>
              {status.tone === "playing" ? (
                <span className="gm-eq" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : null}
              {status.label}
            </span>
          ) : null}
          {isPlayerTab ? (
            <span className="gm-pill gm-pill--player">Playlist</span>
          ) : null}
        </div>

        <div className="gm-card__flags" aria-hidden="true">
          {tab.pinned ? <IconPin className="gm-flag" /> : null}
          {muted ? (
            <IconVolumeMuted className="gm-flag" />
          ) : tab.audible ? (
            <IconVolume className="gm-flag gm-flag--live" />
          ) : null}
        </div>

        {time ? <span className="gm-card__time">{time}</span> : null}
        {progress !== null ? (
          <span className="gm-card__progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${progress})` }} />
          </span>
        ) : null}
        {busy ? (
          <span className="gm-card__busy">
            <Spinner />
          </span>
        ) : null}
      </div>

      <div className="gm-card__body">
        <h4 className="gm-card__title">{title}</h4>
        <p className="gm-card__meta">
          {showBrowser ? (
            <span className="gm-card__browser">{browserName}</span>
          ) : null}
          {meta || tab.url}
        </p>
      </div>

      <div className="gm-card__actions">
        <button
          type="button"
          className="gm-icon-btn"
          onClick={() => actions.focus(tab, browserId, browserName)}
          title="Show tab"
          aria-label="Show tab"
        >
          <IconOpenInTab />
        </button>
        {controllable ? (
          <button
            type="button"
            className="gm-icon-btn gm-icon-btn--primary"
            onClick={() => actions.togglePlay(tab, browserId)}
            disabled={busy}
            title={playing ? "Pause" : "Play"}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <IconPause /> : <IconPlay />}
          </button>
        ) : null}
        {controllable || tab.audible || muted ? (
          <button
            type="button"
            className="gm-icon-btn"
            onClick={() => actions.setMuted(tab, browserId, !muted)}
            title={muted ? "Unmute tab" : "Mute tab"}
            aria-label={muted ? "Unmute tab" : "Mute tab"}
            aria-pressed={muted}
          >
            {muted ? <IconVolumeMuted /> : <IconVolume />}
          </button>
        ) : null}
        <span className="gm-card__spacer" />
        <button
          type="button"
          className="gm-icon-btn"
          onClick={() => actions.reload(tab, browserId)}
          disabled={busy}
          title="Reload tab"
          aria-label="Reload tab"
        >
          <IconReload />
        </button>
        <button
          type="button"
          className={[
            "gm-icon-btn",
            "gm-icon-btn--danger",
            closeConfirm ? "gm-icon-btn--confirm" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={handleClose}
          disabled={busy}
          title={closeTitle}
          aria-label={closeTitle}
        >
          <IconX />
        </button>
      </div>
    </article>
  );
}

/**
 * A medium tab card: thumbnail, title, site, and the tab's controls.
 *
 * Memoized on what it displays (see {@link sameCardTab}) — with hundreds of
 * cards on screen and the browser stream ticking several times a second,
 * re-rendering only the cards that changed is what keeps the page smooth.
 */
export const TabCard = memo(
  TabCardView,
  (prev, next) =>
    prev.browserId === next.browserId &&
    prev.browserName === next.browserName &&
    prev.showBrowser === next.showBrowser &&
    prev.isPlayerTab === next.isPlayerTab &&
    prev.busy === next.busy &&
    prev.actions === next.actions &&
    sameCardTab(prev.tab, next.tab),
);
