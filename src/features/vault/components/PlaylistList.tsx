import { useState } from "react";
import type { Playlist } from "../types";
import { EmptyState } from "./EmptyState";
import { IconMusicNote, IconChevronRight, IconTrash } from "../../../shared/ui/icons";

export function PlaylistList({
  playlists,
  itemCountFor,
  playingPlaylistId,
  onOpen,
  onCreate,
  onDelete,
}: {
  playlists: Playlist[];
  itemCountFor: (p: Playlist) => number;
  /** Id of the playlist currently playing through the player (if any). */
  playingPlaylistId?: string | null;
  onOpen: (p: Playlist) => void;
  onCreate: (name: string, emoji: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onCreate(n, emoji.trim() || null);
    setName("");
    setEmoji("");
    setCreating(false);
  };

  return (
    <div className="pilpod-vault-list">
      <div className="pilpod-vault-list__head">
        <span className="pilpod-vault-list__title">Playlists</span>
        <button
          type="button"
          className="pilpod-vault-btn pilpod-vault-btn--primary"
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? "Cancel" : "New playlist"}
        </button>
      </div>

      {creating ? (
        <div className="pilpod-vault-create">
          <input
            className="pilpod-vault-input pilpod-vault-create__emoji"
            value={emoji}
            placeholder="🎵"
            aria-label="Emoji"
            maxLength={4}
            onChange={(e) => setEmoji(e.target.value)}
          />
          <input
            className="pilpod-vault-input"
            value={name}
            placeholder="Playlist name"
            aria-label="Playlist name"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <button
            type="button"
            className="pilpod-vault-btn pilpod-vault-btn--primary"
            disabled={!name.trim()}
            onClick={submit}
          >
            Create
          </button>
        </div>
      ) : null}

      {playlists.length === 0 ? (
        <EmptyState
          icon={<IconMusicNote />}
          title="No playlists yet"
          hint="Create one, then add tabs that are playing audio or video."
        />
      ) : (
        <ul className="pilpod-vault-rows">
          {playlists.map((p) => (
            <li
              key={p.id}
              className={[
                "pilpod-vault-row",
                playingPlaylistId === p.id ? "pilpod-vault-row--playlist-live" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="pilpod-vault-row__main">
                <div className="pilpod-vault-row__thumb pilpod-vault-row__thumb--emoji" aria-hidden>
                  {p.emoji || <IconMusicNote className="pilpod-icon--sm" />}
                </div>
                <button
                  type="button"
                  className="pilpod-vault-row__body"
                  onClick={() => onOpen(p)}
                >
                  <span className="pilpod-vault-row__title">{p.name}</span>
                  <span className="pilpod-vault-row__url">
                    {itemCountFor(p)} {itemCountFor(p) === 1 ? "item" : "items"}
                  </span>
                </button>
                <div className="pilpod-vault-row__actions">
                  {playingPlaylistId === p.id ? (
                    <span className="pilpod-vault-row__now-playing-badge" aria-label="Currently playing">
                      <IconMusicNote className="pilpod-icon--sm" /> playing
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={[
                      "pilpod-vault-row__icon",
                      confirmId === p.id ? "pilpod-vault-row__icon--danger" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={confirmId === p.id ? "Click again to delete" : "Delete playlist"}
                    aria-label="Delete playlist"
                    onClick={() => {
                      if (confirmId === p.id) {
                        onDelete(p.id);
                        setConfirmId(null);
                      } else {
                        setConfirmId(p.id);
                        setTimeout(() => setConfirmId((c) => (c === p.id ? null : c)), 2500);
                      }
                    }}
                  >
                    <IconTrash className="pilpod-icon--sm" />
                  </button>
                  <button
                    type="button"
                    className="pilpod-vault-row__icon"
                    title="Open playlist"
                    aria-label="Open playlist"
                    onClick={() => onOpen(p)}
                  >
                    <IconChevronRight className="pilpod-icon--sm" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
