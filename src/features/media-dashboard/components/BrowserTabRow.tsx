/**
 * Legacy media-tab row — superseded by UnifiedTabRow.
 * Kept for reference; no longer rendered by BrowserSessionsPanel.
 */
import "./BrowserTabRow.css";
import type { BrowserTab } from "../../../types/media";
import { isTabPlaying, mediaArtist, mediaTimeLabel, tabStateBadge, USER_IDLE_WARN_MS } from "../lib/browserMedia";
import { BrowserMediaThumb } from "./BrowserMediaThumb";
import { IconOpenInTab, IconPause, IconPlay, Spinner } from "../../../shared/ui/icons";

type Props = {
  tab: BrowserTab;
  browserId: string;
  busy: boolean;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocusTab: (tab: BrowserTab, browserId: string) => void;
  onReactivate?: (tab: BrowserTab, browserId: string) => void;
};

export function BrowserTabRow({ tab, browserId, busy, onPlayPause, onFocusTab, onReactivate }: Props) {
  const playing = isTabPlaying(tab);
  const artist = tab.media ? mediaArtist(tab.media) : null;
  const timeLabel = tab.media ? mediaTimeLabel(tab.media) : null;
  const ts = tab.tabState?.toLowerCase() ?? "";
  const badge = tabStateBadge(tab.tabState);
  const showReactivate = onReactivate != null && (ts === "sleeping" || ts === "crashed");
  const idleWarn = (tab.media?.userIdleMs ?? 0) > USER_IDLE_WARN_MS;

  const rowClass = [
    "pilpod-browser-tab-row",
    playing ? "pilpod-browser-tab-row--playing" : "",
    ts === "inactive" ? "pilpod-browser-tab-row--inactive" : "",
    tab.media?.pageVisible === false ? "pilpod-browser-tab-row--hidden-page" : "",
  ].filter(Boolean).join(" ");

  const playClass = [
    "pilpod-browser-tab-row__play",
    playing ? "pilpod-browser-tab-row__play--playing" : "",
  ].filter(Boolean).join(" ");

  return (
    <li className={rowClass}>
      <div className="pilpod-browser-tab-row__thumb-wrap">
        <BrowserMediaThumb tab={tab} />
        <button type="button" title="Open this tab in browser" aria-label="Open this tab in browser"
          onClick={(e) => { e.stopPropagation(); void onFocusTab(tab, browserId); }}
          className="pilpod-browser-tab-row__open-tab">
          <IconOpenInTab className="pilpod-icon--sm" />
        </button>
      </div>
      <div className="pilpod-browser-tab-row__body">
        <p className="pilpod-browser-tab-row__title-row" title={tab.title?.trim() || undefined}>
          <span className="pilpod-browser-tab-row__title">{tab.title?.trim() || "Untitled"}</span>
          {badge ? <span className="pilpod-browser-tab-row__tab-state-badge" title={`Tab state: ${tab.tabState ?? "unknown"}`} aria-hidden>{badge}</span> : null}
        </p>
        {(artist || timeLabel || idleWarn) ? (
          <p className="pilpod-browser-tab-row__meta">
            {artist}
            {artist && timeLabel ? <span className="pilpod-browser-tab-row__meta-sep" aria-hidden>|</span> : null}
            {timeLabel ?? ""}
            {idleWarn ? <><span className="pilpod-browser-tab-row__meta-sep" aria-hidden>|</span><span className="pilpod-browser-tab-row__idle-hint">Idle {Math.round((tab.media?.userIdleMs ?? 0) / 60_000)}m</span></> : null}
          </p>
        ) : null}
      </div>
      {showReactivate ? (
        <button type="button" disabled={busy} className="pilpod-browser-tab-row__reactivate"
          title="Reload and focus this tab" onClick={() => void onReactivate?.(tab, browserId)}>
          Reactivate
        </button>
      ) : null}
      <button type="button" disabled={busy} title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause" : "Play"}
        onClick={() => void onPlayPause(tab, browserId)} className={playClass}>
        {busy ? <Spinner /> : playing ? <IconPause className="pilpod-icon--sm" /> : <IconPlay className="pilpod-icon--sm" />}
      </button>
    </li>
  );
}
