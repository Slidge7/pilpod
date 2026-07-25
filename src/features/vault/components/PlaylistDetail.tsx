import { useState } from "react";
import type { MediaItem, Playlist } from "../types";
import type { DetectedBrowser } from "../../../types/media";
import { formatDuration } from "../../media-dashboard/lib/browserMedia";
import { EmptyState } from "./EmptyState";
import {
  IconChevronRight,
  IconMusicNote,
  IconOpenInTab,
  IconPlay,
  IconTrash,
} from "../../../shared/ui/icons";
import { PlaylistPlayerControls } from "../../playlist-player/components/PlaylistPlayerControls";
import type { PlaylistPlayerApi } from "../../playlist-player/hooks/usePlaylistPlayer";

function letterTile(text: string): string {
  const c = text.trim().charAt(0).toUpperCase();
  return c || "♪";
}

/** Summed duration label across items that report a duration. */
function totalDuration(items: MediaItem[]): string | null {
  const secs = items.reduce((sum, m) => sum + (m.durationSecs ?? 0), 0);
  return secs > 0 ? formatDuration(secs) : null;
}

export function PlaylistDetail({
  playlist,
  items,
  canOpen,
  browsers,
  player,
  onBack,
  onOpenItem,
  onRemoveItem,
  onReorder,
  onRename,
}: {
  playlist: Playlist;
  items: MediaItem[];
  canOpen: boolean;
  browsers?: DetectedBrowser[];
  player?: PlaylistPlayerApi;
  onBack: () => void;
  onOpenItem: (m: MediaItem) => void;
  onRemoveItem: (itemId: string) => void;
  onReorder: (itemIds: string[]) => void;
  onRename: (name: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [dragId, setDragId] = useState<string | null>(null);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next.map((m) => m.id));
  };

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = items.map((m) => m.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    onReorder(ids);
    setDragId(null);
  };

  const total = totalDuration(items);

  const isLivePlaylist =
    player != null && player.player.active && player.player.playlistId === playlist.id;
  const nowPlayingItemId = isLivePlaylist ? player.player.currentItemId ?? null : null;

  return (
    <div className="pilpod-vault-list">
      <div className="pilpod-vault-detail__head">
        <button
          type="button"
          className="pilpod-vault-row__icon"
          title="Back to playlists"
          aria-label="Back to playlists"
          onClick={onBack}
        >
          <IconChevronRight className="pilpod-icon--sm pilpod-vault-flip" />
        </button>
        <span className="pilpod-vault-detail__emoji" aria-hidden>
          {playlist.emoji || <IconMusicNote className="pilpod-icon--sm" />}
        </span>
        {renaming ? (
          <input
            className="pilpod-vault-input"
            value={name}
            aria-label="Playlist name"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim()) onRename(name.trim());
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (name.trim()) onRename(name.trim());
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="pilpod-vault-detail__title"
            title="Rename"
            onClick={() => setRenaming(true)}
          >
            {playlist.name}
          </button>
        )}
        <span className="pilpod-vault-detail__meta">
          {items.length} {items.length === 1 ? "item" : "items"}
          {total ? ` · ${total}` : ""}
        </span>
      </div>

      {player && browsers ? (
        <PlaylistPlayerControls playlist={playlist} browsers={browsers} api={player} />
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={<IconMusicNote />}
          title="Empty playlist"
          hint="Add a tab that's playing audio or video from the Media view."
        />
      ) : (
        <ul className="pilpod-vault-rows">
          {items.map((m, i) => {
            const title = m.mediaTitle?.trim() || m.pageTitle?.trim() || m.url;
            const art = m.artworkUrl?.trim() || null;
            const isNowPlaying = nowPlayingItemId === m.id;
            return (
              <li
                key={m.id}
                className={[
                  "pilpod-vault-row",
                  dragId === m.id ? "pilpod-vault-row--dragging" : "",
                  isNowPlaying ? "pilpod-vault-row--now-playing" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable
                onDragStart={() => setDragId(m.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(m.id)}
                onDragEnd={() => setDragId(null)}
              >
                <div className="pilpod-vault-row__main">
                  <div className="pilpod-vault-row__thumb">
                    {art ? (
                      <img src={art} alt="" width={20} height={20} loading="lazy" decoding="async" />
                    ) : (
                      <span className="pilpod-vault-row__thumb-letter" aria-hidden>
                        {letterTile(title)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="pilpod-vault-row__body"
                    title={canOpen ? "Open" : m.url}
                    disabled={!canOpen}
                    onClick={() => canOpen && onOpenItem(m)}
                  >
                    <span className="pilpod-vault-row__title">{title}</span>
                    <span className="pilpod-vault-row__url">
                      {m.artist?.trim() || m.url}
                      {m.durationSecs ? ` · ${formatDuration(m.durationSecs)}` : ""}
                    </span>
                  </button>
                  <div className="pilpod-vault-row__actions">
                    {isNowPlaying ? (
                      <span className="pilpod-vault-row__now-playing-badge" aria-live="polite">
                        <IconMusicNote className="pilpod-icon--sm" /> playing
                      </span>
                    ) : isLivePlaylist && player ? (
                      <button
                        type="button"
                        className="pilpod-vault-row__icon"
                        title="Play this track now"
                        aria-label={`Play ${title} now`}
                        onClick={() => void player.playItem(m.id)}
                      >
                        <IconPlay className="pilpod-icon--sm" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="pilpod-vault-row__icon"
                      title="Move up"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="pilpod-vault-row__icon"
                      title="Move down"
                      aria-label="Move down"
                      disabled={i === items.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    {canOpen ? (
                      <button
                        type="button"
                        className="pilpod-vault-row__icon"
                        title="Open"
                        aria-label="Open"
                        onClick={() => onOpenItem(m)}
                      >
                        <IconOpenInTab className="pilpod-icon--sm" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="pilpod-vault-row__icon"
                      title="Remove from playlist"
                      aria-label="Remove from playlist"
                      onClick={() => onRemoveItem(m.id)}
                    >
                      <IconTrash className="pilpod-icon--sm" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
