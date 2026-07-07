import { useState } from "react";
import type { Playlist } from "../types";
import { IconMusicNote } from "../../../shared/ui/icons";

/**
 * Popover to add the current media tab to a playlist. Lists existing playlists
 * and offers inline creation. Styled with the float-menu conventions.
 */
export function AddToPlaylistMenu({
  playlists,
  containingIds,
  onPick,
  onCreate,
  onClose,
}: {
  playlists: Playlist[];
  /** Ids of playlists that already contain this media (shown as checked). */
  containingIds: ReadonlySet<string>;
  onPick: (playlistId: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");

  return (
    <div className="pilpod-vault-menu" role="menu">
      <div className="pilpod-vault-menu__head">
        <span>Add to playlist</span>
        <button
          type="button"
          className="pilpod-vault-menu__close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="pilpod-vault-menu__list">
        {playlists.length === 0 ? (
          <p className="pilpod-vault-menu__empty">No playlists yet — create one below.</p>
        ) : (
          playlists.map((p) => {
            const inList = containingIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={inList}
                className="pilpod-vault-menu__item"
                onClick={() => onPick(p.id)}
              >
                <span className="pilpod-vault-menu__emoji" aria-hidden>
                  {p.emoji || <IconMusicNote className="pilpod-icon--sm" />}
                </span>
                <span className="pilpod-vault-menu__label">{p.name}</span>
                <span className="pilpod-vault-menu__check" aria-hidden>
                  {inList ? "✓" : ""}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="pilpod-vault-menu__create">
        <input
          className="pilpod-vault-input"
          value={name}
          placeholder="New playlist…"
          aria-label="New playlist name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              onCreate(name.trim());
              setName("");
            }
          }}
        />
        <button
          type="button"
          className="pilpod-vault-btn pilpod-vault-btn--primary"
          disabled={!name.trim()}
          onClick={() => {
            if (name.trim()) {
              onCreate(name.trim());
              setName("");
            }
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
