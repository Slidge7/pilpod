import { useState } from "react";
import type { BookmarkCollection, Playlist } from "../types";
import { IconBookmark, IconMusicNote, IconPlus } from "../../../shared/ui/icons";

/**
 * "Where should this tab go?" — the single menu behind the bookmark button.
 *
 * Purely presentational: the parent owns every set and every write, so this
 * component re-renders cheaply and is trivial to test. Two sections:
 *
 *   * **Playlists** — rendered only for media tabs (`showPlaylists`), and first,
 *     because for a playing tab that is nearly always the intent.
 *   * **Bookmarks** — always present. "All bookmarks" is the default target and
 *     is not a stored collection; picking it toggles the bookmark itself.
 *     Collection rows toggle membership and imply saving.
 */

export interface SaveTargetMenuProps {
  /** Media tab ⇒ show the playlists section on top. */
  showPlaylists: boolean;
  playlists: readonly Playlist[];
  collections: readonly BookmarkCollection[];
  /** Playlists that already contain this tab. */
  inPlaylistIds: ReadonlySet<string>;
  /** Collections this tab's bookmark is filed under. */
  inCollectionIds: ReadonlySet<string>;
  /** Whether the tab is bookmarked at all (drives the default row's check). */
  saved: boolean;
  onPickPlaylist: (playlistId: string) => void;
  onCreatePlaylist: (name: string) => void;
  /** Toggle membership of a collection (saves the bookmark first if needed). */
  onPickCollection: (collectionId: string) => void;
  onCreateCollection: (name: string) => void;
  /** The "All bookmarks" row: save when unsaved, remove when saved. */
  onToggleDefault: () => void;
  onClose: () => void;
}

/** Fixed menu box so the anchoring hook can place it before it renders. */
export const SAVE_MENU_WIDTH = 248;
export const SAVE_MENU_MAX_HEIGHT = 380;

export function SaveTargetMenu({
  showPlaylists,
  playlists,
  collections,
  inPlaylistIds,
  inCollectionIds,
  saved,
  onPickPlaylist,
  onCreatePlaylist,
  onPickCollection,
  onCreateCollection,
  onToggleDefault,
  onClose,
}: SaveTargetMenuProps) {
  return (
    <div
      className="pilpod-vault-menu pilpod-vault-menu--save"
      role="menu"
      aria-label="Save this tab to"
    >
      <div className="pilpod-vault-menu__head">
        <span>Save to</span>
        <button
          type="button"
          className="pilpod-vault-menu__close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="pilpod-vault-menu__scroll">
        {showPlaylists ? (
          <MenuSection
            label="Playlists"
            icon={<IconMusicNote className="pilpod-icon--sm" />}
            emptyHint="No playlists yet."
            createLabel="New playlist"
            createPlaceholder="Playlist name…"
            onCreate={onCreatePlaylist}
          >
            {playlists.map((p) => (
              <MenuRow
                key={p.id}
                checked={inPlaylistIds.has(p.id)}
                glyph={p.emoji || <IconMusicNote className="pilpod-icon--sm" />}
                label={p.name}
                onClick={() => onPickPlaylist(p.id)}
              />
            ))}
          </MenuSection>
        ) : null}

        <MenuSection
          label="Bookmarks"
          icon={<IconBookmark className="pilpod-icon--sm" />}
          createLabel="New collection"
          createPlaceholder="Collection name…"
          onCreate={onCreateCollection}
        >
          <MenuRow
            checked={saved}
            glyph={<IconBookmark className="pilpod-icon--sm" />}
            label="All bookmarks"
            hint="Default"
            onClick={onToggleDefault}
          />
          {collections.map((c) => (
            <MenuRow
              key={c.id}
              checked={inCollectionIds.has(c.id)}
              glyph={c.emoji || <IconBookmark className="pilpod-icon--sm" />}
              label={c.name}
              onClick={() => onPickCollection(c.id)}
            />
          ))}
        </MenuSection>
      </div>
    </div>
  );
}

/** A titled group with its own inline "create a new target" affordance. */
function MenuSection({
  label,
  icon,
  emptyHint,
  createLabel,
  createPlaceholder,
  onCreate,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  emptyHint?: string;
  createLabel: string;
  createPlaceholder: string;
  onCreate: (name: string) => void;
  children: React.ReactNode;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const rows = Array.isArray(children) ? children.flat() : [children];
  const isEmpty = rows.filter(Boolean).length === 0;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setName("");
    setCreating(false);
  };

  return (
    <div className="pilpod-vault-menu__section">
      <div className="pilpod-vault-menu__section-head">
        <span className="pilpod-vault-menu__section-icon" aria-hidden>
          {icon}
        </span>
        {label}
      </div>

      {isEmpty && emptyHint ? (
        <p className="pilpod-vault-menu__empty">{emptyHint}</p>
      ) : (
        children
      )}

      {creating ? (
        <div className="pilpod-vault-menu__create">
          <input
            className="pilpod-vault-input"
            value={name}
            placeholder={createPlaceholder}
            aria-label={createPlaceholder}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                // Cancel creation without closing the whole menu.
                e.stopPropagation();
                setCreating(false);
                setName("");
              }
            }}
          />
          <button
            type="button"
            className="pilpod-vault-btn pilpod-vault-btn--primary"
            disabled={!name.trim()}
            onClick={submit}
          >
            Add
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="pilpod-vault-menu__item pilpod-vault-menu__item--create"
          onClick={() => setCreating(true)}
        >
          <span className="pilpod-vault-menu__emoji" aria-hidden>
            <IconPlus className="pilpod-icon--sm" />
          </span>
          <span className="pilpod-vault-menu__label">{createLabel}</span>
        </button>
      )}
    </div>
  );
}

function MenuRow({
  checked,
  glyph,
  label,
  hint,
  onClick,
}: {
  checked: boolean;
  glyph: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className="pilpod-vault-menu__item"
      onClick={onClick}
    >
      <span className="pilpod-vault-menu__emoji" aria-hidden>
        {glyph}
      </span>
      <span className="pilpod-vault-menu__label" title={label}>
        {label}
      </span>
      {hint ? <span className="pilpod-vault-menu__hint">{hint}</span> : null}
      <span className="pilpod-vault-menu__check" aria-hidden>
        {checked ? "✓" : ""}
      </span>
    </button>
  );
}
