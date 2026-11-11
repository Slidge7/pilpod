import { useMemo } from "react";
import type { BrowserTab, DetectedBrowser } from "../../../../../types/media";
import { useSaveTargets, type Playlist } from "../../../../vault";
import {
  browserDisplayLabel,
  isTabPlaying,
  tabIsLinkIdentifiedMedia,
} from "../../../../media-dashboard";
import { IconCheck, IconPlus } from "../../../../../shared/ui/icons";
import { useLiveBrowsers, useVaultData } from "../../../data/SkyData";
import { visibleTabs } from "../../../data/browserStats";
import { hostOf } from "../../../search/lib/text";
import { Thumb } from "../../../ui/Thumb";

type Entry = { tab: BrowserTab; browser: DetectedBrowser; label: string };

/**
 * Media open in any connected browser, one click from this playlist.
 * Playing tabs come first; a row already in the playlist can be taken out.
 */
export function AddFromTabsPanel({ playlist }: { playlist: Playlist }) {
  const { browsers } = useLiveBrowsers();
  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const browser of browsers) {
      const label = browserDisplayLabel(browser);
      for (const tab of visibleTabs(browser)) {
        if (tab.media || tabIsLinkIdentifiedMedia(tab)) out.push({ tab, browser, label });
      }
    }
    return out.sort((a, b) => Number(isTabPlaying(b.tab)) - Number(isTabPlaying(a.tab)));
  }, [browsers]);

  return (
    <div className="sky-addtabs">
      <p className="sky-addtabs__head">Add media from open tabs</p>
      {entries.length === 0 ? (
        <p className="sky-addtabs__empty">No videos or music are open in a connected browser right now.</p>
      ) : (
        <ul className="sky-addtabs__list">
          {entries.map((e) => (
            <MediaTabRow key={`${e.browser.id}:${e.tab.tabId}`} entry={e} playlist={playlist} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MediaTabRow({ entry, playlist }: { entry: Entry; playlist: Playlist }) {
  const vault = useVaultData();
  const { tab, browser, label } = entry;
  const provenance = useMemo(
    () => ({ osBrowserId: browser.osBrowserId, displayName: browser.displayName, profileLabel: browser.profileLabel ?? null }),
    [browser.osBrowserId, browser.displayName, browser.profileLabel],
  );
  const targets = useSaveTargets(vault, tab, provenance);
  const added = targets.inPlaylistIds.has(playlist.id);
  const host = hostOf(tab.url) ?? "";
  const title = tab.media?.title?.trim() || tab.title?.trim() || host;

  return (
    <li className="sky-addtabs__row">
      <Thumb src={tab.media?.artworkUrl} glyph="♪" hueKey={host} kind="art" className="sky-addtabs__art" />
      <span className="sky-addtabs__text">
        <span className="sky-addtabs__title" title={title}>
          {title}
        </span>
        <span className="sky-addtabs__meta">
          {[tab.media?.artist, host, label].filter(Boolean).join(" · ")}
        </span>
      </span>
      <button
        type="button"
        className={`sky-btn${added ? " is-added" : ""}`}
        aria-pressed={added}
        title={added ? `Remove from ${playlist.name}` : `Add to ${playlist.name}`}
        onClick={() => targets.pickPlaylist(playlist.id)}
      >
        {added ? <IconCheck /> : <IconPlus />}
        {added ? "Added" : "Add"}
      </button>
    </li>
  );
}
