import { useState, type ReactNode } from "react";
import type { BrowserTab } from "../../../types/media";
import { useSaveTargets } from "../../vault";
import { IconBookmark, IconCheck, IconMusicNote, IconPlus } from "../../../shared/ui/icons";
import { useVaultData } from "../data/SkyData";
import { useCaptureBrowser } from "./useCaptureBrowser";

/**
 * "Save this tab to…" — playlists (for media) and bookmarks with their
 * collections. Rows are checkboxes: the menu stays open so one tab can go to
 * several places in one go. The rules are the dashboard's (`useSaveTargets`).
 */
export function SaveTargetsPanel({
  tab,
  browserId,
  isMedia,
}: {
  tab: BrowserTab;
  browserId: string;
  isMedia: boolean;
}) {
  const vault = useVaultData();
  const browser = useCaptureBrowser(browserId);
  const t = useSaveTargets(vault, tab, browser);
  const { playlists, collections } = vault.vault;

  return (
    <div className="sky-save">
      {isMedia ? (
        <Group
          title="Add to playlist"
          icon={<IconMusicNote />}
          empty={playlists.length === 0 ? "No playlists yet." : null}
          createLabel="New playlist"
          onCreate={(name) => void t.createPlaylist(name)}
        >
          {playlists.map((p) => (
            <Row
              key={p.id}
              checked={t.inPlaylistIds.has(p.id)}
              glyph={p.emoji || "♪"}
              label={p.name}
              hint={`${p.itemIds.length}`}
              onClick={() => t.pickPlaylist(p.id)}
            />
          ))}
        </Group>
      ) : null}

      <Group
        title="Bookmark"
        icon={<IconBookmark />}
        createLabel="New collection"
        onCreate={(name) => void t.createCollection(name)}
      >
        <Row
          checked={t.saved}
          glyph={<IconBookmark />}
          label="All bookmarks"
          hint={t.saved ? "Saved" : "Not saved"}
          onClick={t.toggleDefault}
        />
        {collections.map((c) => (
          <Row
            key={c.id}
            checked={t.inCollectionIds.has(c.id)}
            glyph={c.emoji || c.name.charAt(0).toUpperCase()}
            label={c.name}
            onClick={() => t.pickCollection(c.id)}
          />
        ))}
      </Group>
    </div>
  );
}

function Group({
  title,
  icon,
  empty,
  createLabel,
  onCreate,
  children,
}: {
  title: string;
  icon: ReactNode;
  empty?: string | null;
  createLabel: string;
  onCreate: (name: string) => void;
  children: ReactNode;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const submit = () => {
    const value = name.trim();
    if (!value) return;
    onCreate(value);
    setName("");
    setCreating(false);
  };
  return (
    <section className="sky-save__group" aria-label={title}>
      <h4 className="sky-save__title">
        <span aria-hidden="true">{icon}</span>
        {title}
      </h4>
      <div role="group" aria-label={title}>
        {empty ? <p className="sky-save__empty">{empty}</p> : children}
      </div>
      {creating ? (
        <form
          className="sky-save__create"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            className="sky-input"
            value={name}
            placeholder={`${createLabel.replace("New ", "")} name`}
            aria-label={`${createLabel} name`}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setCreating(false);
              }
            }}
          />
          <button type="submit" className="sky-btn sky-btn--primary" disabled={!name.trim()}>
            Add
          </button>
        </form>
      ) : (
        <button type="button" className="sky-save__row sky-save__row--create" onClick={() => setCreating(true)}>
          <span className="sky-save__glyph" aria-hidden="true">
            <IconPlus />
          </span>
          <span className="sky-save__label">{createLabel}</span>
        </button>
      )}
    </section>
  );
}

function Row({
  checked,
  glyph,
  label,
  hint,
  onClick,
}: {
  checked: boolean;
  glyph: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className="sky-save__row"
      onClick={onClick}
    >
      <span className="sky-save__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="sky-save__label" title={label}>
        {label}
      </span>
      {hint ? <span className="sky-save__hint">{hint}</span> : null}
      <span className="sky-save__check" aria-hidden="true">
        {checked ? <IconCheck /> : null}
      </span>
    </button>
  );
}
