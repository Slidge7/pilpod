import { useState } from "react";
import type { Bookmark, BookmarkCollection } from "../../../../vault";
import { IconCheck } from "../../../../../shared/ui/icons";
import { formatTags, parseTags } from "../lib/tags";

/**
 * Edit one bookmark: its title, tags, notes and the collections it is filed
 * in. Nothing is written until Save; the vault broadcasts the result to every
 * window, so the card updates on its own.
 */
export function BookmarkEditor({
  bookmark,
  collections,
  onSave,
  onCancel,
}: {
  bookmark: Bookmark;
  collections: readonly BookmarkCollection[];
  onSave: (patch: { title: string; tags: string[]; notes: string; collectionIds: string[] }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(bookmark.title);
  const [tags, setTags] = useState(formatTags(bookmark.tags));
  const [notes, setNotes] = useState(bookmark.notes ?? "");
  const [inCollections, setInCollections] = useState<ReadonlySet<string>>(() => new Set(bookmark.collectionIds));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = (id: string) =>
    setInCollections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    const ok = await onSave({
      title: title.trim() || bookmark.url,
      tags: parseTags(tags),
      notes: notes.trim(),
      collectionIds: [...inCollections],
    });
    setSaving(false);
    if (ok) onCancel();
    else setFailed(true);
  };

  return (
    <form
      className="sky-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="sky-editor__field">
        <span>Title</span>
        <input className="sky-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <label className="sky-editor__field">
        <span>Tags</span>
        <input
          className="sky-input"
          value={tags}
          placeholder="react, docs"
          onChange={(e) => setTags(e.target.value)}
        />
        <small>Separate with commas or spaces.</small>
      </label>
      <label className="sky-editor__field">
        <span>Notes</span>
        <textarea className="sky-input sky-input--area" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {collections.length > 0 ? (
        <fieldset className="sky-editor__field sky-editor__collections">
          <legend>Collections</legend>
          {collections.map((c) => {
            const on = inCollections.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                className="sky-save__row"
                onClick={() => toggle(c.id)}
              >
                <span className="sky-save__glyph" aria-hidden="true">
                  {c.emoji || c.name.charAt(0).toUpperCase()}
                </span>
                <span className="sky-save__label">{c.name}</span>
                <span className="sky-save__check" aria-hidden="true">
                  {on ? <IconCheck /> : null}
                </span>
              </button>
            );
          })}
        </fieldset>
      ) : null}
      {failed ? <p className="sky-inline-error">Could not save the changes. Try again.</p> : null}
      <div className="sky-editor__actions">
        <button type="button" className="sky-textbtn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="sky-btn sky-btn--primary" disabled={saving}>
          Save
        </button>
      </div>
    </form>
  );
}
