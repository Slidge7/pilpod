import { useMemo } from "react";
import "./BrowserDockBar.css";
import type { DetectedBrowser } from "../../../types/media";
import { scrollToBrowserProfile } from "../lib/browserProfileScroll";
import {
  IconBookmark,
  IconDownloadTray,
  IconMusicNote,
} from "../../../shared/ui/icons";

/**
 * The dashboard's main views. Exported so `MediaDashboard` shares this exact
 * union instead of re-declaring it — they drifted once already.
 *
 * `"setup"` has no dock button on purpose: it is reached from the menu and from
 * locked browser rows, and while it is open no dock button reads as active,
 * which is the honest signal that you are somewhere else.
 */
export type ViewType = "media" | "download" | "vault" | "playlist" | "setup";

type Props = {
  browsers: DetectedBrowser[];
  activeBrowserId: string | null;
  onActiveBrowserChange: (browserId: string) => void;
  view: ViewType;
  onSelectView: (view: ViewType) => void;
  downloaderEnabled: boolean;
  vaultEnabled: boolean;
  playlistEnabled: boolean;
};

function browserDisplayLabel(browser: DetectedBrowser): string {
  return browser.profileLabel ?? browser.displayName;
}

export function BrowserDockBar({
  browsers,
  activeBrowserId,
  onActiveBrowserChange,
  view,
  onSelectView,
  downloaderEnabled,
  vaultEnabled,
  playlistEnabled,
}: Props) {
  const openBrowsers = useMemo(
    () =>
      [...browsers]
        .filter((b) => b.running)
        .sort((a, b) =>
          browserDisplayLabel(a).localeCompare(browserDisplayLabel(b)),
        ),
    [browsers],
  );

  const hasBrowsers = openBrowsers.length > 0;
  const hasViewButtons = downloaderEnabled || vaultEnabled || playlistEnabled;

  if (!hasBrowsers && !hasViewButtons) {
    return null;
  }

  const isMediaView = view === "media";

  return (
    <nav
      className="pilpod-browser-dock"
      aria-label="Open browsers"
      data-tauri-drag-region="deep"
    >
      {hasBrowsers ? (
        <div className="pilpod-browser-dock__browsers-wrap">
          <div
            className="pilpod-browser-dock__scroll"
            role="toolbar"
            aria-label="Jump to browser"
          >
            {openBrowsers.map((browser) => {
              const label = browserDisplayLabel(browser);
              const isActive = activeBrowserId === browser.id;
              return (
                <button
                  key={browser.id}
                  type="button"
                  className={
                    isActive
                      ? "pilpod-browser-dock__btn pilpod-browser-dock__btn--active"
                      : "pilpod-browser-dock__btn"
                  }
                  title={label}
                  aria-label={`Scroll to ${label}`}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => {
                    onActiveBrowserChange(browser.id);
                    scrollToBrowserProfile(browser.id);
                  }}
                >
                  {browser.iconUrl ? (
                    <img
                      src={browser.iconUrl}
                      alt=""
                      className="pilpod-browser-dock__icon"
                      width={16}
                      height={16}
                    />
                  ) : (
                    <span className="pilpod-browser-dock__icon-fallback" aria-hidden />
                  )}
                  <span className="pilpod-browser-dock__label">{label}</span>
                </button>
              );
            })}
          </div>
          {/* Overlay: invisible, covers all browser buttons; appears on hover, click → media */}
          {!isMediaView && (
            <button
              type="button"
              className="pilpod-browser-dock__back-overlay"
              onClick={() => onSelectView("media")}
              title="Back to Media"
              aria-label="Back to Media view"
            />
          )}
        </div>
      ) : null}

      {/* Spacer pushes view buttons to the right */}
      <span className="pilpod-browser-dock__spacer" />

      {/* View switcher buttons */}
      {downloaderEnabled ? (
        <button
          type="button"
          className={`pilpod-browser-dock__view-btn${view === "download" ? " pilpod-browser-dock__view-btn--active" : ""}`}
          title="Downloads"
          aria-label="Downloads"
          aria-pressed={view === "download"}
          onClick={() => onSelectView(view === "download" ? "media" : "download")}
        >
          <IconDownloadTray />
        </button>
      ) : null}
      {vaultEnabled ? (
        <button
          type="button"
          className={`pilpod-browser-dock__view-btn${view === "vault" ? " pilpod-browser-dock__view-btn--active" : ""}`}
          title="Bookmarks"
          aria-label="Bookmarks"
          aria-pressed={view === "vault"}
          onClick={() => onSelectView(view === "vault" ? "media" : "vault")}
        >
          <IconBookmark />
        </button>
      ) : null}
      {playlistEnabled ? (
        <button
          type="button"
          className={`pilpod-browser-dock__view-btn${view === "playlist" ? " pilpod-browser-dock__view-btn--active" : ""}`}
          title="Playlists"
          aria-label="Playlists"
          aria-pressed={view === "playlist"}
          onClick={() => onSelectView(view === "playlist" ? "media" : "playlist")}
        >
          <IconMusicNote />
        </button>
      ) : null}
    </nav>
  );
}
