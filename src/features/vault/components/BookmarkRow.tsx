import { useState } from "react";
import type { Bookmark, BookmarkPatchArgs } from "../types";
import {
  IconBookmarkFilled,
  IconOpenInTab,
  IconPin,
  IconTrash,
} from "../../../shared/ui/icons";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function BookmarkRow({
  bookmark,
  onOpen,
  onTogglePin,
  onRemove,
  onSaveEdit,
  canOpen,
}: {
  bookmark: Bookmark;
  onOpen: (b: Bookmark) => void;
  onTogglePin: (b: Bookmark) => void;
  onRemove: (id: string) => void;
  onSaveEdit: (patch: BookmarkPatchArgs) => void;
  canOpen: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(bookmark.title);
  const [tagsText, setTagsText] = useState(bookmark.tags.join(", "));
  const [notes, setNotes] = useState(bookmark.notes ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const fav = bookmark.faviconUrl?.trim() || null;

  const commit = () => {
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onSaveEdit({
      id: bookmark.id,
      title: title.trim() || bookmark.url,
      tags,
      // Empty string clears the note; non-empty sets it (see BookmarkPatchArgs).
      notes: notes.trim(),
    });
    setEditing(false);
  };

  const cancel = () => {
    setTitle(bookmark.title);
    setTagsText(bookmark.tags.join(", "));
    setNotes(bookmark.notes ?? "");
    setEditing(false);
  };

  return (
    <li
      className={[
        "pilpod-vault-row",
        bookmark.pinned ? "pilpod-vault-row--pinned" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="pilpod-vault-row__main">
        <div className="pilpod-vault-row__thumb">
          {fav ? (
            <img src={fav} alt="" width={20} height={20} loading="lazy" decoding="async" />
          ) : (
            <span className="pilpod-vault-row__thumb-fallback" aria-hidden />
          )}
        </div>

        <button
          type="button"
          className="pilpod-vault-row__body"
          title={canOpen ? "Open" : bookmark.url}
          disabled={!canOpen}
          onClick={() => canOpen && onOpen(bookmark)}
        >
          <span className="pilpod-vault-row__title">
            {bookmark.pinned ? (
              <IconBookmarkFilled className="pilpod-vault-row__pin-glyph" />
            ) : null}
            {bookmark.title || "Untitled"}
          </span>
          <span className="pilpod-vault-row__url">{hostOf(bookmark.url)}</span>
        </button>

        <div className="pilpod-vault-row__actions">
          {canOpen ? (
            <button
              type="button"
              className="pilpod-vault-row__icon"
              title="Open"
              aria-label="Open"
              onClick={() => onOpen(bookmark)}
            >
              <IconOpenInTab className="pilpod-icon--sm" />
            </button>
          ) : null}
          <button
            type="button"
            className={[
              "pilpod-vault-row__icon",
              bookmark.pinned ? "pilpod-vault-row__icon--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={bookmark.pinned ? "Unpin" : "Pin"}
            aria-label={bookmark.pinned ? "Unpin" : "Pin"}
            aria-pressed={bookmark.pinned}
            onClick={() => onTogglePin(bookmark)}
          >
            <IconPin className="pilpod-icon--sm" />
          </button>
          <button
            type="button"
            className="pilpod-vault-row__icon"
            title="Edit"
            aria-label="Edit"
            onClick={() => setEditing((v) => !v)}
          >
            ✎
          </button>
          <button
            type="button"
            className={[
              "pilpod-vault-row__icon",
              confirmRemove ? "pilpod-vault-row__icon--danger" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={confirmRemove ? "Click again to remove" : "Remove"}
            aria-label="Remove"
            onClick={() => {
              if (confirmRemove) onRemove(bookmark.id);
              else {
                setConfirmRemove(true);
                setTimeout(() => setConfirmRemove(false), 2500);
              }
            }}
          >
            <IconTrash className="pilpod-icon--sm" />
          </button>
        </div>
      </div>

      {bookmark.tags.length > 0 && !editing ? (
        <div className="pilpod-vault-row__tags">
          {bookmark.tags.map((t) => (
            <span key={t} className="pilpod-vault-chip">
              {t}
            </span>
          ))}
        </div>
      ) : null}

      {editing ? (
        <div className="pilpod-vault-row__edit">
          <input
            className="pilpod-vault-input"
            value={title}
            placeholder="Title"
            aria-label="Title"
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="pilpod-vault-input"
            value={tagsText}
            placeholder="tags, comma, separated"
            aria-label="Tags"
            onChange={(e) => setTagsText(e.target.value)}
          />
          <textarea
            className="pilpod-vault-input pilpod-vault-textarea"
            value={notes}
            placeholder="Notes"
            aria-label="Notes"
            rows={2}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="pilpod-vault-row__edit-actions">
            <button type="button" className="pilpod-vault-btn" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="pilpod-vault-btn pilpod-vault-btn--primary"
              onClick={commit}
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
