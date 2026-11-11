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
  IconBlock,
  IconOpenInTab,
  IconPause,
  IconPin,
  IconPlay,
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
import { SaveTabButton, TabControlsButton } from "../../../tabs/TabMenus";
import { isSavableUrl } from "../../../tabs/lib/controls";
import { isBlockableUrl, youtubeBlockApi } from "../../../../youtube-block";

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
  /** The tab's page is in the vault. */
  saved: boolean;
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
  saved,
  actions,
}: Props) {
  const savable = isSavableUrl(tab.url);
  const blockable = isBlockableUrl(tab.url);
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
    "sky-card",
    playing ? "sky-card--playing" : "",
    tab.active ? "sky-card--active" : "",
    lifecycle === "sleeping" ? "sky-card--sleeping" : "",
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
        className="sky-card__open"
        onClick={() => actions.focus(tab, browserId, browserName)}
        title={`${title}\n${tab.url}`}
        aria-label={`Show “${title}” in ${browserName}`}
      />

      <div className="sky-card__media">
        <TabThumbnail tab={tab} />

        <div className="sky-card__badges">
          {status ? (
            <span className={`sky-pill sky-pill--${status.tone}`}>
              {status.tone === "playing" ? (
                <span className="sky-eq" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : null}
              {status.label}
            </span>
          ) : null}
          {isPlayerTab ? (
            <span className="sky-pill sky-pill--player">Playlist</span>
          ) : null}
        </div>

        <div className="sky-card__flags" aria-hidden="true">
          {tab.pinned ? <IconPin className="sky-flag" /> : null}
          {muted ? (
            <IconVolumeMuted className="sky-flag" />
          ) : tab.audible ? (
            <IconVolume className="sky-flag sky-flag--live" />
          ) : null}
        </div>

        {time ? <span className="sky-card__time">{time}</span> : null}
        {progress !== null ? (
          <span className="sky-card__progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${progress})` }} />
          </span>
        ) : null}
        {busy ? (
          <span className="sky-card__busy">
            <Spinner />
          </span>
        ) : null}
      </div>

      <div className="sky-card__body">
        <h4 className="sky-card__title">{title}</h4>
        <p className="sky-card__meta">
          {showBrowser ? (
            <span className="sky-card__browser">{browserName}</span>
          ) : null}
          {meta || tab.url}
        </p>
      </div>

      <div className="sky-card__actions">
        <button
          type="button"
          className="sky-icon-btn"
          onClick={() => actions.focus(tab, browserId, browserName)}
          title="Show tab"
          aria-label="Show tab"
        >
          <IconOpenInTab />
        </button>
        {controllable ? (
          <button
            type="button"
            className="sky-icon-btn sky-icon-btn--primary"
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
            className="sky-icon-btn"
            onClick={() => actions.setMuted(tab, browserId, !muted)}
            title={muted ? "Unmute tab" : "Mute tab"}
            aria-label={muted ? "Unmute tab" : "Mute tab"}
            aria-pressed={muted}
          >
            {muted ? <IconVolumeMuted /> : <IconVolume />}
          </button>
        ) : null}
        <span className="sky-card__spacer" />
        {blockable ? (
          <button
            type="button"
            className="sky-icon-btn sky-icon-btn--danger"
            onClick={() =>
              void youtubeBlockApi
                .add({ url: tab.url, title: media?.title?.trim() || tab.title, browserName })
                .catch((err: unknown) => console.error("[sky] block video:", err))
            }
            title="Block this video — it is skipped whenever it plays out of focus"
            aria-label="Block this video"
          >
            <IconBlock />
          </button>
        ) : null}
        {savable ? (
          <SaveTabButton tab={tab} browserId={browserId} saved={saved} isMedia={controllable || Boolean(media)} />
        ) : null}
        <TabControlsButton tab={tab} browserId={browserId} browserName={browserName} />
        <button
          type="button"
          className={[
            "sky-icon-btn",
            "sky-icon-btn--danger",
            closeConfirm ? "sky-icon-btn--confirm" : "",
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
    prev.saved === next.saved &&
    prev.actions === next.actions &&
    sameCardTab(prev.tab, next.tab),
);
