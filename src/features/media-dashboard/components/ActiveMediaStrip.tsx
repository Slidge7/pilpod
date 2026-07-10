import { type ReactNode, useCallback, useMemo } from "react";
import "./ActiveMediaStrip.css";
import type { BrowserTab, DetectedBrowser } from "../../../types/media";
import { collectActiveMediaTabs, tabRowKey } from "../lib/browserMedia";
import { useFlipList } from "../hooks/useFlipList";
import { useSettledOrder } from "../hooks/useSettledOrder";
import { useStickyMedia } from "../hooks/useStickyMedia";
import { MediaItemCard } from "./MediaItemCard";

/** Reorder the strip only after this long with no play/pause/interaction. */
const SORT_SETTLE_MS = 10_000;
/** Keep a media row in place this long while it reloads/navigates. */
const MEDIA_STICKY_MS = 7_000;

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
  onPip?: (tab: BrowserTab, browserId: string) => void;
  /** Render save/download buttons for a tab (mirrors browser card accessories). */
  renderTabAccessories?: (
    tab: BrowserTab,
    browserId: string,
    browserDisplayName: string,
    isMediaTab: boolean,
  ) => { save?: ReactNode; download?: ReactNode };
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
  onPip,
  renderTabAccessories,
}: Props) {
  // Keep rows in place across a reload/navigation gap before classifying media.
  const stickyBrowsers = useStickyMedia(browsers, MEDIA_STICKY_MS);
  const sortedMedia = useMemo(
    () => collectActiveMediaTabs(stickyBrowsers),
    [stickyBrowsers],
  );
  // Hold the order steady while the user is toggling; re-sort once they settle.
  const activeMedia = useSettledOrder(
    sortedMedia,
    (match) => tabRowKey(match.tab),
    SORT_SETTLE_MS,
  );
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
          const accessories = renderTabAccessories?.(tab, browserId, browserDisplayName, true);
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
              onPip={onPip}
              saveButton={accessories?.save}
              downloadButton={accessories?.download}
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
