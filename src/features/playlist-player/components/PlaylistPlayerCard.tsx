import { useMemo, type ReactNode } from "react";
import "../PlaylistPlayer.css";
import type { BrowserTab, DetectedBrowser } from "../../../types/media";
import type { Playlist } from "../../vault/types";
import { MediaItemCard } from "../../media-dashboard/components/MediaItemCard";
import { tabRowKey } from "../../media-dashboard/lib/browserMedia";
import {
  IconMusicNote,
  IconSkipBack,
  IconSkipForward,
  IconX,
  Spinner,
} from "../../../shared/ui/icons";
import type { PlaylistPlayerApi } from "../hooks/usePlaylistPlayer";
import { playerErrorMessage } from "../types";
import { PlayerModeButtons } from "./PlayerModeButtons";

type Props = {
  api: PlaylistPlayerApi;
  browsers: DetectedBrowser[];
  playlists: Playlist[];
  pendingKeys: ReadonlySet<string>;
  onPlayPause: (tab: BrowserTab, browserId: string) => void;
  onFocusTab: (tab: BrowserTab, browserId: string, displayName: string) => void | Promise<void>;
  onReload: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onClose: (tab: BrowserTab, browserId: string) => void | Promise<void>;
  onSeekTab?: (tab: BrowserTab, browserId: string, seekTo: number) => void;
  onSetTabVolume?: (tab: BrowserTab, browserId: string, volume: number) => void;
  onPip?: (tab: BrowserTab, browserId: string) => void;
  renderTabAccessories?: (
    tab: BrowserTab,
    browserId: string,
    browserDisplayName: string,
    isMediaTab: boolean,
  ) => { save?: ReactNode; download?: ReactNode };
};

/**
 * Minimalist "now playing playlist" card shown on the media dashboard between
 * the search bar and the active-media strip. Wraps the player tab's media card
 * (all its controls except in-tab next/prev) inside a playlist frame that owns
 * track navigation and modes. Renders nothing while no playlist session is
 * active — zero cost on the dashboard's hot path.
 */
export function PlaylistPlayerCard({
  api,
  browsers,
  playlists,
  pendingKeys,
  onPlayPause,
  onFocusTab,
  onReload,
  onClose,
  onSeekTab,
  onSetTabVolume,
  onPip,
  renderTabAccessories,
}: Props) {
  const { player } = api;

  const playlist = useMemo(
    () =>
      player.active && player.playlistId
        ? playlists.find((p) => p.id === player.playlistId) ?? null
        : null,
    [player.active, player.playlistId, playlists],
  );

  const located = useMemo(() => {
    if (!player.active || !player.browserId || player.tabId == null) return null;
    const browser = browsers.find((b) => b.id === player.browserId);
    const tab = browser?.tabs.find((t) => t.tabId === player.tabId);
    return browser && tab ? { browser, tab } : null;
  }, [player.active, player.browserId, player.tabId, browsers]);

  if (!player.active) return null;

  const title = playlist
    ? `${playlist.emoji ? `${playlist.emoji} ` : ""}${playlist.name}`
    : "Playlist";

  const displayName = located
    ? located.browser.profileLabel ?? located.browser.displayName
    : "";
  // Playlist tab is a managed player surface: only the download accessory is
  // meaningful here (no bookmark — the track is already saved in the playlist).
  const accessories =
    located && renderTabAccessories
      ? renderTabAccessories(located.tab, located.browser.id, displayName, true)
      : undefined;

  return (
    <section
      className="pilpod-playlist-player"
      aria-label={`Playing playlist: ${title}`}
    >
      <header className="pilpod-playlist-player__head">
        <span className="pilpod-playlist-player__identity">
          <IconMusicNote className="pilpod-icon--sm pilpod-playlist-player__note" />
          <span className="pilpod-playlist-player__title" title={title}>
            {title}
          </span>
          {player.totalTracks > 0 ? (
            <span className="pilpod-playlist-player__counter">
              {player.trackNumber}/{player.totalTracks}
            </span>
          ) : null}
        </span>

        <span className="pilpod-playlist-player__head-spacer" />

        <button
          type="button"
          className="pilpod-player-mode-btn pilpod-player-mode-btn--compact"
          title="Previous track"
          aria-label="Previous track"
          onClick={() => void api.prev()}
        >
          <IconSkipBack className="pilpod-icon--sm" />
        </button>
        <button
          type="button"
          className="pilpod-player-mode-btn pilpod-player-mode-btn--compact"
          title="Next track"
          aria-label="Next track"
          onClick={() => void api.next()}
        >
          <IconSkipForward className="pilpod-icon--sm" />
        </button>

        <PlayerModeButtons
          compact
          repeat={player.repeat}
          autoPlay={player.autoPlay}
          onRepeatChange={(mode) => void api.setModes({ repeat: mode })}
          onAutoPlayChange={(on) => void api.setModes({ autoPlay: on })}
        />

        <button
          type="button"
          className="pilpod-player-mode-btn pilpod-player-mode-btn--compact pilpod-playlist-player__dismiss"
          title={
            player.target === "inApp"
              ? "Stop playlist and close the player window"
              : "Stop playlist and close the player tab"
          }
          aria-label="Stop playlist"
          onClick={() => void api.stop(true)}
        >
          <IconX className="pilpod-icon--sm" />
        </button>
      </header>

      {located ? (
        <ul className="pilpod-playlist-player__tab">
          <MediaItemCard
            tab={located.tab}
            browserId={located.browser.id}
            browserDisplayName={displayName}
            variant="inset"
            busy={pendingKeys.has(tabRowKey(located.tab))}
            hideTrackTransport
            hideTabActions
            onPlayPause={onPlayPause}
            onFocus={onFocusTab}
            onReload={onReload}
            onClose={onClose}
            onSeek={onSeekTab}
            onSetTabVolume={onSetTabVolume}
            onPip={onPip}
            downloadButton={accessories?.download}
          />
        </ul>
      ) : (
        <div
          className={[
            "pilpod-playlist-player__pending",
            player.status === "error" ? "pilpod-playlist-player__pending--error" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {player.status === "error" ? (
            playerErrorMessage(player.error ?? "error")
          ) : (
            <>
              <Spinner />
              <span>
                {player.target === "inApp"
                  ? "Opening player window…"
                  : "Opening player tab…"}
              </span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
