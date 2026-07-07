import { useMemo, useState } from "react";
import type { Bookmark, BookmarkPatchArgs } from "../types";
import {
  collectTags,
  filterBookmarksByTags,
  orderBookmarks,
  searchBookmarks,
} from "../lib/vaultSearch";
import { BookmarkRow } from "./BookmarkRow";
import { EmptyState } from "./EmptyState";
import { IconBookmark } from "../../../shared/ui/icons";

export function BookmarkList({
  bookmarks,
  canOpen,
  onOpen,
  onTogglePin,
  onRemove,
  onSaveEdit,
}: {
  bookmarks: Bookmark[];
  canOpen: boolean;
  onOpen: (b: Bookmark) => void;
  onTogglePin: (b: Bookmark) => void;
  onRemove: (id: string) => void;
  onSaveEdit: (patch: BookmarkPatchArgs) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set());

  const allTags = useMemo(() => collectTags(bookmarks), [bookmarks]);

  const visible = useMemo(() => {
    const tagFiltered = filterBookmarksByTags(bookmarks, selectedTags);
    if (query.trim()) return searchBookmarks(tagFiltered, query);
    return orderBookmarks(tagFiltered);
  }, [bookmarks, selectedTags, query]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  if (bookmarks.length === 0) {
    return (
      <EmptyState
        icon={<IconBookmark />}
        title="No bookmarks yet"
        hint="Save any tab from the Media view to keep it here."
      />
    );
  }

  return (
    <div className="pilpod-vault-list">
      <div className="pilpod-vault-searchbar">
        <span className="pilpod-vault-searchbar__icon" aria-hidden>⌕</span>
        <input
          type="search"
          className="pilpod-vault-searchbar__input"
          placeholder="Search bookmarks…"
          value={query}
          aria-label="Search bookmarks"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="pilpod-vault-searchbar__clear"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            ×
          </button>
        ) : null}
      </div>

      {allTags.length > 0 ? (
        <div className="pilpod-vault-tagbar">
          {allTags.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              className={[
                "pilpod-vault-chip",
                "pilpod-vault-chip--btn",
                selectedTags.has(tag) ? "pilpod-vault-chip--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={selectedTags.has(tag)}
              onClick={() => toggleTag(tag)}
            >
              {tag}
              <span className="pilpod-vault-chip__count">{count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState title="No matches" hint="Try a different search or tag." />
      ) : (
        <ul className="pilpod-vault-rows">
          {visible.map((b) => (
            <BookmarkRow
              key={b.id}
              bookmark={b}
              canOpen={canOpen}
              onOpen={onOpen}
              onTogglePin={onTogglePin}
              onRemove={onRemove}
              onSaveEdit={onSaveEdit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
