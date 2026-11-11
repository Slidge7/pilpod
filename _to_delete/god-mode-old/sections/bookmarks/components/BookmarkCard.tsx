import { memo, useEffect, useState } from "react";
import type { Bookmark } from "../../../../vault";
import { faviconFromUrl } from "../../../../media-dashboard";
import { IconCheck, IconOpenInTab, IconPin, IconTrash } from "../../../../../shared/ui/icons";
import { Highlight } from "../../../search/components/Highlight";
import { hostOf } from "../../../search/lib/text";
import { Thumb } from "../../../ui/Thumb";
import { timeAgo } from "../../../ui/format";
import { useConfirm } from "../../../ui/useConfirm";

/** Tags shown on a card; the rest are summed up as "+n". */
const MAX_TAGS = 3;

export type BookmarkActions = {
  open: (b: Bookmark) => void;
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
  actions: BookmarkActions;
};

function BookmarkCardView({ bookmark, terms, activeTags, actions }: Props) {
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
    <article className={`gm-bm${bookmark.pinned ? " gm-bm--pinned" : ""}`}>
      <button
        type="button"
        className="gm-bm__open"
        onClick={() => actions.open(bookmark)}
        title={`${title}\n${bookmark.url}`}
        aria-label={`Open ${title}`}
      />
      <Thumb
        src={bookmark.faviconUrl || faviconFromUrl(bookmark.url)}
        glyph={host.charAt(0).toUpperCase()}
        hueKey={host}
        className="gm-bm__icon"
      />
      <div className="gm-bm__text">
        <h3 className="gm-bm__title">
          <Highlight text={title} terms={terms} />
        </h3>
        <p className="gm-bm__host">
          <Highlight text={host} terms={terms} />
        </p>
      </div>
      {bookmark.pinned ? <IconPin className="gm-bm__pin" /> : null}

      <footer className="gm-bm__foot">
        {bookmark.tags.length > 0 ? (
          <ul className="gm-bm__tags" aria-label="Tags">
            {bookmark.tags.slice(0, MAX_TAGS).map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  className="gm-tag"
                  aria-pressed={activeTags.has(tag)}
                  onClick={() => actions.toggleTag(tag)}
                  title={activeTags.has(tag) ? `Stop filtering by #${tag}` : `Show only #${tag}`}
                >
                  #{tag}
                </button>
              </li>
            ))}
            {bookmark.tags.length > MAX_TAGS ? (
              <li className="gm-bm__more" title={bookmark.tags.slice(MAX_TAGS).map((t) => `#${t}`).join(" ")}>
                +{bookmark.tags.length - MAX_TAGS}
              </li>
            ) : null}
          </ul>
        ) : (
          <span className="gm-bm__when">
            {bookmark.lastOpenedAtMs
              ? `Opened ${timeAgo(bookmark.lastOpenedAtMs)}`
              : `Saved ${timeAgo(bookmark.createdAtMs)}`}
          </span>
        )}

        <span className="gm-bm__actions">
          <button
            type="button"
            className="gm-icon-btn"
            title="Open"
            aria-label="Open"
            onClick={() => actions.open(bookmark)}
          >
            <IconOpenInTab />
          </button>
          <button
            type="button"
            className="gm-icon-btn"
            aria-pressed={bookmark.pinned}
            title={bookmark.pinned ? "Unpin" : "Pin to the top"}
            aria-label={bookmark.pinned ? "Unpin" : "Pin to the top"}
            onClick={() => actions.togglePin(bookmark)}
          >
            <IconPin />
          </button>
          <button
            type="button"
            className="gm-icon-btn gm-icon-btn--text"
            title="Copy the address"
            onClick={() => void actions.copy(bookmark).then(setCopied)}
          >
            {copied ? <IconCheck /> : "Copy"}
          </button>
          <button
            type="button"
            className={`gm-icon-btn gm-icon-btn--danger${remove.armed ? " is-armed" : ""}`}
            title={remove.armed ? "Press again to remove" : "Remove bookmark"}
            aria-label={remove.armed ? "Press again to remove" : "Remove bookmark"}
            onClick={remove.press}
          >
            {remove.armed ? "Remove?" : <IconTrash />}
          </button>
        </span>
      </footer>
    </article>
  );
}

export const BookmarkCard = memo(BookmarkCardView);
