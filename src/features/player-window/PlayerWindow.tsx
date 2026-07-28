import { useCallback, useMemo, useRef } from "react";
import { IconMusicNote, Spinner } from "../../shared/ui/icons";
import { formatDuration } from "../media-dashboard/lib/browserMedia";
import { usePlaylistPlayer } from "../playlist-player";
import { playerErrorMessage } from "../playlist-player/types";
import { useVault } from "../vault";
import type { MediaItem } from "../vault/types";
import { PlayerHeader } from "./components/PlayerHeader";
import { PlayerTransport } from "./components/PlayerTransport";
import { PlayerTrackList } from "./components/PlayerTrackList";
import { useInAppMedia } from "./hooks/useInAppMedia";
import "./PlayerWindow.css";

/**
 * Root of the `player-ui` webview — the lower two thirds of the in-app player
 * window. The video itself is the sibling `player-stage` webview tiled above
 * this one, so there is no video element here: this surface owns the chrome,
 * the transport and the playlist.
 *
 * Every piece of state comes from Rust, which is also what the dashboard reads,
 * so the two views can never disagree:
 *   * `usePlaylistPlayer` → session (track number, modes, current item)
 *   * `useInAppMedia`     → the stage's live media (position, volume, loading)
 *   * `useVault`          → the playlist's tracks
 */
/** A saved item's own fields, as the vault's "add media" payload. */
function asAddArgs(item: MediaItem) {
  return {
    url: item.url,
    pageTitle: item.pageTitle,
    mediaTitle: item.mediaTitle ?? null,
    artist: item.artist ?? null,
    album: item.album ?? null,
    artworkUrl: item.artworkUrl ?? null,
    durationSecs: item.durationSecs ?? null,
    mediaMatchRule: item.mediaMatchRule ?? null,
    kind: item.kind,
    sourceOsBrowserId: item.sourceOsBrowserId ?? null,
  };
}

export function PlayerWindow() {
  // Poll alongside the event stream: this window is small and always in the
  // foreground, and a stale transport here reads as "the buttons don't work".
  const player = usePlaylistPlayer(1000);
  const media = useInAppMedia();
  const vaultApi = useVault();
  const { vault } = vaultApi;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const playlist = useMemo(
    () =>
      player.player.playlistId
        ? vault.playlists.find((p) => p.id === player.player.playlistId) ?? null
        : null,
    [player.player.playlistId, vault.playlists],
  );

  const items = useMemo<MediaItem[]>(() => {
    if (!playlist) return [];
    const byId = new Map(vault.mediaItems.map((m) => [m.id, m]));
    return playlist.itemIds
      .map((id) => byId.get(id))
      .filter((m): m is MediaItem => m != null);
  }, [playlist, vault.mediaItems]);

  const totalSecs = useMemo(
    () => items.reduce((sum, m) => sum + (m.durationSecs ?? 0), 0),
    [items],
  );

  /** Every other playlist — the possible destinations for move/copy. */
  const otherPlaylists = useMemo(
    () => vault.playlists.filter((p) => p.id !== playlist?.id),
    [vault.playlists, playlist?.id],
  );

  const playlistId = playlist?.id ?? null;

  const reorder = useCallback(
    (itemIds: string[]) => {
      if (playlistId) void vaultApi.reorderPlaylist(playlistId, itemIds);
    },
    [playlistId, vaultApi],
  );

  const removeTrack = useCallback(
    (item: MediaItem) => {
      if (playlistId) void vaultApi.removeFromPlaylist(playlistId, item.id);
    },
    [playlistId, vaultApi],
  );

  const copyTrack = useCallback(
    async (item: MediaItem, targetId: string) => {
      await vaultApi.addMediaToPlaylist(targetId, asAddArgs(item));
    },
    [vaultApi],
  );

  const moveTrack = useCallback(
    async (item: MediaItem, targetId: string) => {
      // Copy first: a failed add must never lose the track.
      const added = await vaultApi.addMediaToPlaylist(targetId, asAddArgs(item));
      if (added && playlistId) {
        await vaultApi.removeFromPlaylist(playlistId, item.id);
      }
    },
    [playlistId, vaultApi],
  );

  const currentItemId = player.player.currentItemId ?? null;
  const currentItem = items.find((m) => m.id === currentItemId) ?? null;

  // The stage reports the real media title once it loads; until then the saved
  // one keeps the header from being blank.
  const nowPlaying =
    media.media.title.trim() ||
    currentItem?.mediaTitle?.trim() ||
    currentItem?.pageTitle?.trim() ||
    "";
  const nowArtist = media.media.artist.trim() || currentItem?.artist?.trim() || "";

  const title = playlist
    ? `${playlist.emoji ? `${playlist.emoji} ` : ""}${playlist.name}`
    : "Playlist";

  return (
    <div className="pilpod-pw">
      <PlayerHeader
        title={title}
        trackNumber={player.player.trackNumber}
        totalTracks={player.player.totalTracks}
        onClose={() => void player.stop(true)}
      />

      {/*
        Reserved slot for the video. The stage is a *separate native webview*
        laid over exactly this rectangle by `window::relayout`, so nothing may
        be rendered here — the 16:9 ratio and the header height above it are the
        contract with the Rust side.
      */}
      <div className="pilpod-pw-stage-slot" aria-hidden />

      <div className="pilpod-pw-now">
        <span className="pilpod-pw-now__art" aria-hidden>
          {media.media.artworkUrl || currentItem?.artworkUrl ? (
            <img
              src={media.media.artworkUrl || currentItem?.artworkUrl || ""}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : (
            <IconMusicNote className="pilpod-icon--sm" />
          )}
        </span>
        <span className="pilpod-pw-now__text">
          {media.media.loading ? (
            <span className="pilpod-pw-now__loading">
              <Spinner />
              <span>Loading track…</span>
            </span>
          ) : (
            <>
              <span className="pilpod-pw-now__title" title={nowPlaying}>
                {nowPlaying || "Nothing playing"}
              </span>
              {nowArtist ? (
                <span className="pilpod-pw-now__artist">{nowArtist}</span>
              ) : null}
            </>
          )}
        </span>
      </div>

      {player.player.status === "error" ? (
        <div className="pilpod-pw-error">
          {playerErrorMessage(player.player.error ?? "error")}
        </div>
      ) : null}

      <PlayerTransport
        api={media}
        repeat={player.player.repeat}
        shuffle={player.player.shuffle}
        autoPlay={player.player.autoPlay}
        onNext={() => void player.next()}
        onPrev={() => void player.prev()}
        onRepeat={(mode) => void player.setModes({ repeat: mode })}
        onShuffle={(on) => void player.setModes({ shuffle: on })}
        onAutoPlay={(on) => void player.setModes({ autoPlay: on })}
      />

      <div className="pilpod-pw-scroll" ref={scrollRef}>
        <PlayerTrackList
          items={items}
          currentItemId={currentItemId}
          otherPlaylists={otherPlaylists}
          scrollRef={scrollRef}
          onPlayItem={(id) => void player.playItem(id)}
          onReorder={reorder}
          onRemove={removeTrack}
          onMove={(item, target) => void moveTrack(item, target)}
          onCopy={(item, target) => void copyTrack(item, target)}
        />
      </div>

      <footer className="pilpod-pw-foot">
        <IconMusicNote className="pilpod-icon--sm" />
        <span>
          {items.length} {items.length === 1 ? "track" : "tracks"}
          {totalSecs > 0 ? ` · ${formatDuration(totalSecs)}` : ""}
        </span>
        <span className="pilpod-pw-foot__spacer" />
        <span className="pilpod-pw-foot__mode">
          {player.player.shuffle ? "shuffle" : "in order"}
          {player.player.repeat !== "off" ? ` · repeat ${player.player.repeat}` : ""}
        </span>
      </footer>
    </div>
  );
}
