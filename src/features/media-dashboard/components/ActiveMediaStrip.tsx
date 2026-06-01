import { useCallback, useMemo } from "react";
import "./ActiveMediaStrip.css";
import type { BrowserTab, DetectedBrowser } from "../../../types/media";
import { collectActiveMediaTabs, tabRowKey } from "../lib/browserMedia";
import { useFlipList } from "../hooks/useFlipList";
import { MediaItemCard } from "./MediaItemCard";

type Props = {
  browsers: DetectedBrowser[];
  pendingKeys: ReadonlySet<string>;
  /** When true, strip animates out (search hub expanded / active). */
  searchModeActive?: boolean;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocusTab: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onSeekTab?: (tab: BrowserTab, browserId: string, seekTo: number) => void;
  onSetTabVolume?: (tab: BrowserTab, browserId: string, volume: number) => void;
  onSkipAd?: (tab: BrowserTab, browserId: string) => void;
  onPip?: (tab: BrowserTab, browserId: string) => void;
};

export function ActiveMediaStrip({
  browsers,
  pendingKeys,
  searchModeActive = false,
  onPlayPause,
  onFocusTab,
  onReload,
  onClose,
  onSeekTab,
  onSetTabVolume,
  onSkipAd,
  onPip,
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
              onPlayPause={onPlayPause}
              onFocus={onFocusTab}
              onReload={onReload}
              onClose={onClose}
              onSeek={onSeekTab}
              onSetTabVolume={onSetTabVolume}
              onSkipAd={onSkipAd}
              onPip={onPip}
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
