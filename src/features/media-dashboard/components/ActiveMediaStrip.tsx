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

  if (activeMedia.length === 0) {
    return (
      <section className="pilpod-active-media-strip" aria-live="polite">
        <p className="pilpod-active-media-strip__empty">no media playing now</p>
      </section>
    );
  }

  return (
    <section className="pilpod-active-media-strip">
      <ul
        ref={listRef}
        className="pilpod-control-grid pilpod-active-media-strip__grid"
      >
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
    </section>
  );
}
