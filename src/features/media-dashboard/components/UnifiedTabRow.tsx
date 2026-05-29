import "./UnifiedTabRow.css";
import type { AudioSessionInfoDto, BrowserTab } from "../../../types/media";
import type { DownloadTask } from "../../downloader/types";
import {
  downloadProgressLabel,
  downloadProgressTitle,
} from "../../downloader/lib/activeDownload";
import {
  abbreviatedUrl,
  faviconFromUrl,
  isTabPlaying,
  tabHasMediaControls,
  tabIsLinkIdentifiedMedia,
  mediaArtist,
  mediaTimeLabel,
  tabStateBadge,
  USER_IDLE_WARN_MS,
} from "../lib/browserMedia";
import { AppVolumeSlider } from "../../../shared/ui/AppVolumeSlider";
import { BrowserMediaThumb } from "./BrowserMediaThumb";
import {
  IconDownload,
  IconOpenInTab,
  IconPause,
  IconPlay,
  IconReload,
  IconX,
  Spinner,
} from "../../../shared/ui/icons";
import { useTabCloseConfirm } from "../hooks/useTabCloseConfirm";

type Props = {
  tab: BrowserTab;
  browserId: string;
  browserDisplayName: string;
  busy: boolean;
  /** Show play/pause button (only for media tabs). */
  showMediaControls: boolean;
  profileAudio?: AudioSessionInfoDto;
  onMixerVolume?: (instanceId: string, volume: number) => void;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocus: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onReactivate: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  /** Called when the user clicks the download icon on a media tab. */
  onDownload?: (url: string) => void;
  /** In-progress download for this tab URL, if any. */
  activeDownload?: DownloadTask;
};

export function UnifiedTabRow({
  tab,
  browserId,
  browserDisplayName,
  busy,
  showMediaControls,
  profileAudio,
  onMixerVolume,
  onPlayPause,
  onFocus,
  onReload,
  onClose,
  onReactivate,
  onDownload,
  activeDownload,
}: Props) {
  const ts = (tab.tabState ?? "").toLowerCase();
  const badge = tabStateBadge(tab.tabState);
  const showReactivate = ts === "sleeping" || ts === "crashed";
  const playing = isTabPlaying(tab);
  const isMediaTab = tabIsLinkIdentifiedMedia(tab);
  const hasMediaControls = tabHasMediaControls(tab);
  const isMediaCard = isMediaTab && showMediaControls;

  const { closeConfirm, handleClose, closeTitle } = useTabCloseConfirm({
    onClose: () => void onClose(tab, browserId),
  });

  const fav =
    tab.favIconUrl?.trim() ||
    tab.faviconUrl?.trim() ||
    faviconFromUrl(tab.url ?? "") ||
    null;

  const artist = tab.media ? mediaArtist(tab.media) : null;
  const timeLabel = tab.media ? mediaTimeLabel(tab.media) : null;
  const idleWarn = (tab.media?.userIdleMs ?? 0) > USER_IDLE_WARN_MS;
  const playbackState = (tab.media?.playbackState ?? "").toLowerCase();
  const stateHint =
    isMediaTab && !artist && !timeLabel && playbackState && playbackState !== "none"
      ? playbackState.charAt(0).toUpperCase() + playbackState.slice(1)
      : null;
  const urlShort = abbreviatedUrl(tab.url ?? "");

  const cardClass = [
    "pilpod-control-card",
    isMediaCard ? "pilpod-control-card--media" : "pilpod-control-card--tab",
    playing ? "pilpod-control-card--playing" : "",
    ts === "inactive" && !isMediaTab ? "pilpod-control-card--inactive" : "",
    isMediaTab && tab.media?.pageVisible === false
      ? "pilpod-control-card--hidden-page"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const playClass = [
    "pilpod-control-card__play",
    playing ? "pilpod-control-card__play--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const thumb = isMediaTab ? (
    <BrowserMediaThumb tab={tab} />
  ) : fav ? (
    <img
      src={fav}
      alt=""
      className="pilpod-control-card__fav"
      width={20}
      height={20}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <span className="pilpod-control-card__fav-fallback" aria-hidden />
  );

  return (
    <li className={cardClass}>
      <div className="pilpod-control-card__main">
        <div className="pilpod-control-card__thumb-wrap">
          {thumb}
          <button
            type="button"
            title="Open this tab in browser"
            aria-label="Open this tab in browser"
            className="pilpod-control-card__open-tab"
            onClick={(e) => {
              e.stopPropagation();
              void onFocus(tab, browserId, browserDisplayName);
            }}
          >
            <IconOpenInTab className="pilpod-icon--sm" />
          </button>
        </div>

        <div className="pilpod-control-card__body">
          <p
            className="pilpod-control-card__title-row"
            title={tab.title?.trim() || undefined}
          >
            <span className="pilpod-control-card__title">
              {tab.title?.trim() || "Untitled"}
            </span>
            {tab.audible && !playing ? (
              <span
                className="pilpod-control-card__audible"
                title="Tab is producing sound"
                aria-label="audible"
              >
                🔊
              </span>
            ) : null}
            {badge ? (
              <span
                className="pilpod-control-card__state-badge"
                title={`Tab state: ${tab.tabState ?? "unknown"}`}
                aria-hidden
              >
                {badge}
              </span>
            ) : null}
          </p>

          {(artist || timeLabel || idleWarn || stateHint) ? (
            <p className="pilpod-control-card__meta">
              {artist}
              {artist && timeLabel ? (
                <span className="pilpod-control-card__meta-sep" aria-hidden>|</span>
              ) : null}
              {timeLabel ?? ""}
              {stateHint && !artist && !timeLabel ? stateHint : null}
              {idleWarn ? (
                <>
                  {(artist || timeLabel || stateHint) ? (
                    <span className="pilpod-control-card__meta-sep" aria-hidden>|</span>
                  ) : null}
                  <span className="pilpod-control-card__idle-hint">
                    Idle {Math.round((tab.media?.userIdleMs ?? 0) / 60_000)}m
                  </span>
                </>
              ) : null}
            </p>
          ) : !isMediaTab ? (
            <p className="pilpod-control-card__url" title={tab.url}>
              {urlShort}
            </p>
          ) : null}
        </div>

        <div className="pilpod-control-card__actions">
          {showReactivate ? (
            <button
              type="button"
              disabled={busy}
              className="pilpod-control-card__ghost-btn"
              title="Wake discarded or crashed tab"
              onClick={() => void onReactivate(tab, browserId)}
            >
              Wake
            </button>
          ) : null}

          {!isMediaTab ? (
            <>
              <button
                type="button"
                className="pilpod-control-card__icon-act pilpod-control-card__icon-act--rl"
                disabled={busy}
                title="Reload tab"
                aria-label="Reload tab"
                onClick={() => void onReload(tab, browserId)}
              >
                <IconReload />
              </button>
              <button
                type="button"
                className={`pilpod-control-card__icon-act pilpod-control-card__icon-act--cl${closeConfirm ? " pilpod-control-card__icon-act--cl-confirm" : ""}`}
                disabled={busy}
                title={closeTitle}
                aria-label="Close tab"
                onClick={handleClose}
              >
                <IconX />
              </button>
            </>
          ) : null}

          {showMediaControls && isMediaTab && activeDownload ? (
            <span
              className="pilpod-control-card__dl-progress"
              title={downloadProgressTitle(activeDownload)}
              aria-label={downloadProgressTitle(activeDownload)}
            >
              {(activeDownload.status.type === "Queued" ||
                activeDownload.status.type === "Muxing" ||
                activeDownload.status.type === "FetchingInfo") && (
                <Spinner className="pilpod-icon--sm" />
              )}
              <span>{downloadProgressLabel(activeDownload)}</span>
            </span>
          ) : showMediaControls && isMediaTab && onDownload && tab.url ? (
            <button
              type="button"
              title="Download this video"
              aria-label="Download this video"
              className="pilpod-control-card__ghost-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDownload(tab.url!);
              }}
            >
              <IconDownload className="pilpod-icon--sm" />
            </button>
          ) : null}

          {showMediaControls && hasMediaControls ? (
            <button
              type="button"
              disabled={busy}
              title={playing ? "Pause" : "Play"}
              aria-label={playing ? "Pause" : "Play"}
              className={playClass}
              onClick={() => onPlayPause(tab, browserId)}
            >
              {busy ? (
                <Spinner />
              ) : playing ? (
                <IconPause className="pilpod-icon--sm" />
              ) : (
                <IconPlay className="pilpod-icon--sm" />
              )}
            </button>
          ) : null}
        </div>
      </div>

      {isMediaCard && profileAudio && onMixerVolume ? (
        <div className="pilpod-control-card__volume">
          <AppVolumeSlider
            ariaLabel={`Volume for ${tab.title?.trim() || "media"}`}
            audio={profileAudio}
            onVolumeChange={onMixerVolume}
          />
        </div>
      ) : null}
    </li>
  );
}
