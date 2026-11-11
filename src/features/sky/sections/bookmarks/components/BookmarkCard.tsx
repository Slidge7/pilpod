import { memo, useEffect, useState } from "react";
import type { Bookmark, BookmarkCollection } from "../../../../vault";
import { faviconFromUrl } from "../../../../media-dashboard";
import { IconCheck, IconOpenInTab, IconPencil, IconPin, IconTrash } from "../../../../../shared/ui/icons";
import { Popover, usePopover } from "../../../ui/Popover";
import { BookmarkEditor } from "./BookmarkEditor";
import { Highlight } from "../../../search/components/Highlight";
import { hostOf } from "../../../search/lib/text";
import { Thumb } from "../../../ui/Thumb";
import { timeAgo } from "../../../ui/format";
import { useConfirm } from "../../../ui/useConfirm";

/** Tags shown on a card; the rest are summed up as "+n". */
const MAX_TAGS = 3;

export type BookmarkActions = {
  open: (b: Bookmark) => void;
  /** Save edits; resolves false when the vault refused them. */
  edit: (b: Bookmark, patch: { title: string; tags: string[]; notes: string; collectionIds: string[] }) => Promise<boolean>;
  togglePin: (b: Bookmark) => void;
  remove: (b: Bookmark) => void;
  copy: (b: Bookmark) => Promise<boolean>;
  toggleTag: (tag: string) => void;
};

type Props = {
  bookmark: Bookmark;
  terms: readonly string[];
  /** Tags currently filtering the list, shown as selected on the card. */
  activeTags: ReadonlySet<string>;
  collections: readonly BookmarkCollection[];
  actions: BookmarkActions;
};

const EDITOR_SIZE = { width: 340, height: 460 };

function BookmarkCardView({ bookmark, terms, activeTags, collections, actions }: Props) {
  const editor = usePopover(EDITOR_SIZE);
  const host = hostOf(bookmark.url) ?? bookmark.url;
  const title = bookmark.title.trim() || host;
  const remove = useConfirm(() => actions.remove(bookmark));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);

  return (
    <article className={`sky-bm${bookmark.pinned ? " sky-bm--pinned" : ""}`}>
      <button
        type="button"
        className="sky-bm__open"
        onClick={() => actions.open(bookmark)}
        title={`${title}\n${bookmark.url}`}
        aria-label={`Open ${title}`}
      />
      <Thumb
        src={bookmark.faviconUrl || faviconFromUrl(bookmark.url)}
        glyph={host.charAt(0).toUpperCase()}
        hueKey={host}
        className="sky-bm__icon"
      />
      <div className="sky-bm__text">
        <h3 className="sky-bm__title">
          <Highlight text={title} terms={terms} />
        </h3>
        <p className="sky-bm__host">
          <Highlight text={host} terms={terms} />
        </p>
      </div>
      {bookmark.pinned ? <IconPin className="sky-bm__pin" /> : null}

      <footer className="sky-bm__foot">
        {bookmark.tags.length > 0 ? (
          <ul className="sky-bm__tags" aria-label="Tags">
            {bookmark.tags.slice(0, MAX_TAGS).map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  className="sky-tag"
                  aria-pressed={activeTags.has(tag)}
                  onClick={() => actions.toggleTag(tag)}
                  title={activeTags.has(tag) ? `Stop filtering by #${tag}` : `Show only #${tag}`}
                >
                  #{tag}
                </button>
              </li>
            ))}
            {bookmark.tags.length > MAX_TAGS ? (
              <li className="sky-bm__more" title={bookmark.tags.slice(MAX_TAGS).map((t) => `#${t}`).join(" ")}>
                +{bookmark.tags.length - MAX_TAGS}
              </li>
            ) : null}
          </ul>
        ) : (
          <span className="sky-bm__when">
            {bookmark.lastOpenedAtMs
              ? `Opened ${timeAgo(bookmark.lastOpenedAtMs)}`
              : `Saved ${timeAgo(bookmark.createdAtMs)}`}
          </span>
        )}

        <span className="sky-bm__actions">
          <button
            type="button"
            className="sky-icon-btn"
            title="Open"
            aria-label="Open"
            onClick={() => actions.open(bookmark)}
          >
            <IconOpenInTab />
          </button>
          <button
            ref={editor.anchorRef}
            type="button"
            className="sky-icon-btn"
            title="Edit title, tags, notes and collections"
            aria-label="Edit bookmark"
            aria-haspopup="dialog"
            aria-expanded={editor.open}
            onClick={editor.toggle}
          >
            <IconPencil />
          </button>
          <button
            type="button"
            className="sky-icon-btn"
            aria-pressed={bookmark.pinned}
            title={bookmark.pinned ? "Unpin" : "Pin to the top"}
            aria-label={bookmark.pinned ? "Unpin" : "Pin to the top"}
            onClick={() => actions.togglePin(bookmark)}
          >
            <IconPin />
          </button>
          <button
            type="button"
            className="sky-icon-btn sky-icon-btn--text"
            title="Copy the address"
            onClick={() => void actions.copy(bookmark).then(setCopied)}
          >
            {copied ? <IconCheck /> : "Copy"}
          </button>
          <button
            type="button"
            className={`sky-icon-btn sky-icon-btn--danger${remove.armed ? " is-armed" : ""}`}
            title={remove.armed ? "Press again to remove" : "Remove bookmark"}
            aria-label={remove.armed ? "Press again to remove" : "Remove bookmark"}
            onClick={remove.press}
          >
            {remove.armed ? "Remove?" : <IconTrash />}
          </button>
        </span>
      </footer>
      <Popover {...editor} width={EDITOR_SIZE.width} label={`Edit ${title}`}>
        <BookmarkEditor
          bookmark={bookmark}
          collections={collections}
          onSave={(patch) => actions.edit(bookmark, patch)}
          onCancel={editor.close}
        />
      </Popover>
    </article>
  );
}

export const BookmarkCard = memo(BookmarkCardView);
