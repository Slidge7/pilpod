import "./UnifiedTabRow.css";
import type { BrowserTab } from "../../../types/media";
import {
  abbreviatedUrl,
  faviconFromUrl,
  isTabPlaying,
  mediaArtist,
  mediaTimeLabel,
  tabStateBadge,
  USER_IDLE_WARN_MS,
} from "../lib/browserMedia";
import { BrowserMediaThumb } from "./BrowserMediaThumb";
import {
  IconOpenInTab,
  IconPause,
  IconPlay,
  Spinner,
} from "./icons";

type Props = {
  tab: BrowserTab;
  browserId: string;
  browserDisplayName: string;
  busy: boolean;
  /** Show play/pause button (only for media tabs). */
  showMediaControls: boolean;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocus: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onReactivate: (tab: BrowserTab, browserId: string) => void | Promise<void>;
};

export function UnifiedTabRow({
  tab,
  browserId,
  browserDisplayName,
  busy,
  showMediaControls,
  onPlayPause,
  onFocus,
  onReload,
  onClose,
  onReactivate,
}: Props) {
  const ts = (tab.tabState ?? "").toLowerCase();
  const badge = tabStateBadge(tab.tabState);
  const showReactivate = ts === "sleeping" || ts === "crashed";
  const playing = isTabPlaying(tab);
  const hasMedia = tab.media != null;

  const fav =
    tab.favIconUrl?.trim() ||
    tab.faviconUrl?.trim() ||
    faviconFromUrl(tab.url ?? "") ||
    null;

  const artist = hasMedia && tab.media ? mediaArtist(tab.media) : null;
  const timeLabel = hasMedia && tab.media ? mediaTimeLabel(tab.media) : null;
  const idleWarn = hasMedia && (tab.media?.userIdleMs ?? 0) > USER_IDLE_WARN_MS;
  const urlShort = abbreviatedUrl(tab.url ?? "");

  const rowClass = [
    "pilpod-unified-tab-row",
    playing ? "pilpod-unified-tab-row--playing" : "",
    ts === "inactive" && !hasMedia ? "pilpod-unified-tab-row--inactive" : "",
    hasMedia && tab.media?.pageVisible === false
      ? "pilpod-unified-tab-row--hidden-page"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={rowClass}>
      {/* Favicon / media thumbnail */}
      <div className="pilpod-unified-tab-row__thumb-wrap">
        {hasMedia ? (
          <BrowserMediaThumb tab={tab} />
        ) : (
          <div className="pilpod-unified-tab-row__fav-wrap">
            {fav ? (
              <img
                src={fav}
                alt=""
                className="pilpod-unified-tab-row__fav"
                width={16}
                height={16}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="pilpod-unified-tab-row__fav-fallback" aria-hidden />
            )}
          </div>
        )}

        {/* Focus shortcut button */}
        <button
          type="button"
          title="Open this tab in browser"
          aria-label="Open this tab in browser"
          className="pilpod-unified-tab-row__open-tab"
          onClick={(e) => {
            e.stopPropagation();
            void onFocus(tab, browserId, browserDisplayName);
          }}
        >
          <IconOpenInTab className="pilpod-icon--sm" />
        </button>
      </div>

      {/* Title + meta */}
      <div className="pilpod-unified-tab-row__body">
        <p
          className="pilpod-unified-tab-row__title-row"
          title={tab.title?.trim() || undefined}
        >
          <span className="pilpod-unified-tab-row__title">
            {tab.title?.trim() || "Untitled"}
          </span>
          {tab.audible && !playing ? (
            <span
              className="pilpod-unified-tab-row__audible"
              title="Tab is producing sound"
              aria-label="audible"
            >
              🔊
            </span>
          ) : null}
          {badge ? (
            <span
              className="pilpod-unified-tab-row__state-badge"
              title={`Tab state: ${tab.tabState ?? "unknown"}`}
              aria-hidden
            >
              {badge}
            </span>
          ) : null}
        </p>

        {/* Media meta row */}
        {(artist || timeLabel || idleWarn) ? (
          <p className="pilpod-unified-tab-row__meta">
            {artist}
            {artist && timeLabel ? (
              <span className="pilpod-unified-tab-row__meta-sep" aria-hidden>|</span>
            ) : null}
            {timeLabel ?? ""}
            {idleWarn ? (
              <>
                {(artist || timeLabel) ? (
                  <span className="pilpod-unified-tab-row__meta-sep" aria-hidden>|</span>
                ) : null}
                <span className="pilpod-unified-tab-row__idle-hint">
                  Idle {Math.round((tab.media?.userIdleMs ?? 0) / 60_000)}m
                </span>
              </>
            ) : null}
          </p>
        ) : !hasMedia ? (
          /* Show abbreviated URL for non-media tabs */
          <p className="pilpod-unified-tab-row__url" title={tab.url}>
            {urlShort}
          </p>
        ) : null}
      </div>

      {/* Actions */}
      <div className="pilpod-unified-tab-row__actions">
        {showReactivate ? (
          <button
            type="button"
            disabled={busy}
            className="pilpod-unified-tab-row__btn"
            title="Wake discarded or crashed tab"
            onClick={() => void onReactivate(tab, browserId)}
          >
            Wake
          </button>
        ) : null}

        {!hasMedia ? (
          <>
            <button
              type="button"
              className="pilpod-unified-tab-row__btn"
              disabled={busy}
              title="Reload tab"
              onClick={() => void onReload(tab, browserId)}
            >
              Reload
            </button>
            <button
              type="button"
              className="pilpod-unified-tab-row__btn pilpod-unified-tab-row__btn--danger"
              disabled={busy}
              title="Close tab"
              onClick={() => void onClose(tab, browserId)}
            >
              Close
            </button>
          </>
        ) : null}

        {/* Play/pause for media tabs */}
        {showMediaControls && hasMedia ? (
          <button
            type="button"
            disabled={busy}
            title={playing ? "Pause" : "Play"}
            aria-label={playing ? "Pause" : "Play"}
            className={[
              "pilpod-unified-tab-row__play",
              playing ? "pilpod-unified-tab-row__play--playing" : "",
            ]
              .filter(Boolean)
              .join(" ")}
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
    </li>
  );
}
