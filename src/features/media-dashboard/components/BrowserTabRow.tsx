import "./BrowserTabRow.css";
import type { BrowserTabMediaDto } from "../../../types/media";
import { formatMediaSeconds } from "../lib/format";
import { channelBrowser, isBrowserPlaying } from "../lib/browserMedia";
import { BrowserMediaThumb } from "./BrowserMediaThumb";
import {
  IconOpenInTab,
  IconPause,
  IconPlay,
  Spinner,
} from "./icons";

type Props = {
  tab: BrowserTabMediaDto;
  busy: boolean;
  onPlayPause: (tab: BrowserTabMediaDto) => void;
  onFocusTab: (tab: BrowserTabMediaDto) => void;
};

export function BrowserTabRow({
  tab,
  busy,
  onPlayPause,
  onFocusTab,
}: Props) {
  const playing = isBrowserPlaying(tab);
  const ch = channelBrowser(tab);
  const dur = tab.duration != null && tab.duration > 0 ? tab.duration : null;
  const pos =
    tab.currentTime != null && tab.currentTime >= 0 ? tab.currentTime : 0;
  const timeLabel =
    dur != null
      ? `${formatMediaSeconds(pos)} / ${formatMediaSeconds(dur)}`
      : null;

  const rowClass = [
    "pilpod-browser-tab-row",
    playing ? "pilpod-browser-tab-row--playing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const playClass = [
    "pilpod-browser-tab-row__play",
    playing ? "pilpod-browser-tab-row__play--playing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={rowClass}>
      <div className="pilpod-browser-tab-row__thumb-wrap">
        <BrowserMediaThumb tab={tab} />
        <button
          type="button"
          title="Open this tab in browser"
          aria-label="Open this tab in browser"
          onClick={(e) => {
            e.stopPropagation();
            void onFocusTab(tab);
          }}
          className="pilpod-browser-tab-row__open-tab"
        >
          <IconOpenInTab className="pilpod-icon--sm" />
        </button>
      </div>
      <div className="pilpod-browser-tab-row__body">
        <p
          className="pilpod-browser-tab-row__title"
          title={tab.title?.trim() || undefined}
        >
          {tab.title?.trim() || "Untitled"}
        </p>
        {ch || timeLabel ? (
          <p className="pilpod-browser-tab-row__meta">
            {ch}
            {ch && timeLabel ? (
              <span className="pilpod-browser-tab-row__meta-sep" aria-hidden>
                |
              </span>
            ) : null}
            {timeLabel ?? ""}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={busy}
        title={playing ? "Pause" : "Play"}
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => void onPlayPause(tab)}
        className={playClass}
      >
        {busy ? (
          <Spinner />
        ) : playing ? (
          <IconPause className="pilpod-icon--sm" />
        ) : (
          <IconPlay className="pilpod-icon--sm" />
        )}
      </button>
    </li>
  );
}
