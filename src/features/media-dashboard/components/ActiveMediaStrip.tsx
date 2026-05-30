import { useCallback, useMemo } from "react";
import "./ActiveMediaStrip.css";
import type { AudioSessionInfoDto, BrowserTab, DetectedBrowser } from "../../../types/media";
import { collectActiveMediaTabs, tabRowKey } from "../lib/browserMedia";
import { findActiveDownloadForUrl } from "../../downloader/lib/activeDownload";
import type { DownloadTask } from "../../downloader/types";
import { useFlipList } from "../hooks/useFlipList";
import { MediaItemCard } from "./MediaItemCard";

type Props = {
  browsers: DetectedBrowser[];
  pendingKeys: ReadonlySet<string>;
  browserAudio: Readonly<Record<string, AudioSessionInfoDto>>;
  /** When true, strip animates out (search hub expanded / active). */
  searchModeActive?: boolean;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocusTab: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onMixerVolume: (instanceId: string, volume: number) => void;
  onDownload?: (url: string) => void;
  downloadTasks: Map<string, DownloadTask>;
};

export function ActiveMediaStrip({
  browsers,
  pendingKeys,
  browserAudio,
  searchModeActive = false,
  onPlayPause,
  onFocusTab,
  onReload,
  onClose,
  onMixerVolume,
  onDownload,
  downloadTasks,
}: Props) {
  const activeMedia = useMemo(() => collectActiveMediaTabs(browsers), [browsers]);
  const getFlipKey = useCallback(
    (match: (typeof activeMedia)[number]) => tabRowKey(match.tab),
    [],
  );
  const listRef = useFlipList(activeMedia, getFlipKey);

  const shellClass = [
    "pilpod-active-media-strip-shell",
    searchModeActive ? "pilpod-active-media-strip-shell--hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const stripContent =
    activeMedia.length === 0 ? (
      <p className="pilpod-active-media-strip__empty">no media playing now</p>
    ) : (
      <ul ref={listRef} className="pilpod-active-media-strip__grid">
        {activeMedia.map(({ browserId, browserDisplayName, tab }) => {
          const rk = tabRowKey(tab);
          return (
            <MediaItemCard
              key={rk}
              flipId={rk}
              tab={tab}
              browserId={browserId}
              browserDisplayName={browserDisplayName}
              variant="float"
              rootClassName="pilpod-active-media-strip__item"
              busy={pendingKeys.has(rk)}
              profileAudio={browserAudio[browserId]}
              onMixerVolume={onMixerVolume}
              onPlayPause={onPlayPause}
              onFocus={onFocusTab}
              onReload={onReload}
              onClose={onClose}
              onDownload={onDownload}
              activeDownload={
                tab.url ? findActiveDownloadForUrl(downloadTasks, tab.url) : undefined
              }
            />
          );
        })}
      </ul>
    );

  return (
    <div
      className={shellClass}
      aria-hidden={searchModeActive}
      inert={searchModeActive ? true : undefined}
    >
      <div className="pilpod-active-media-strip-shell__clip">
        <section className="pilpod-active-media-strip" aria-live="polite">
          {stripContent}
        </section>
      </div>
    </div>
  );
}
