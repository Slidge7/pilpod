import { useEffect, useMemo, useState } from "react";
import type { Bookmark, BookmarkCollection, BookmarkPatchArgs } from "../types";
import {
  collectTags,
  countByCollection,
  filterBookmarksByCollection,
  filterBookmarksByTags,
  orderBookmarks,
  searchBookmarks,
  UNFILED,
  type CollectionFilter,
} from "../lib/vaultSearch";
import { BookmarkRow } from "./BookmarkRow";
import { EmptyState } from "./EmptyState";
import { CollectionBar } from "./CollectionBar";
import { IconBookmark } from "../../../shared/ui/icons";

export function BookmarkList({
  bookmarks,
  collections,
  canOpen,
  onOpen,
  onTogglePin,
  onRemove,
  onSaveEdit,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
}: {
  bookmarks: Bookmark[];
  collections: BookmarkCollection[];
  canOpen: boolean;
  onOpen: (b: Bookmark) => void;
  onTogglePin: (b: Bookmark) => void;
  onRemove: (id: string) => void;
  onSaveEdit: (patch: BookmarkPatchArgs) => void;
  onCreateCollection: (name: string) => void;
  onRenameCollection: (id: string, name: string) => void;
  onDeleteCollection: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set());
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>(null);

  const allTags = useMemo(() => collectTags(bookmarks), [bookmarks]);
  const counts = useMemo(() => countByCollection(bookmarks), [bookmarks]);

  // Deleting the collection currently being viewed must not strand the list on
  // an empty filter — fall back to "All".
  useEffect(() => {
    if (
      collectionFilter != null &&
      collectionFilter !== UNFILED &&
      !collections.some((c) => c.id === collectionFilter)
    ) {
      setCollectionFilter(null);
    }
  }, [collections, collectionFilter]);

  const visible = useMemo(() => {
    const scoped = filterBookmarksByCollection(bookmarks, collectionFilter);
    const tagFiltered = filterBookmarksByTags(scoped, selectedTags);
    if (query.trim()) return searchBookmarks(tagFiltered, query);
    return orderBookmarks(tagFiltered);
  }, [bookmarks, collectionFilter, selectedTags, query]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  // Collections are still worth showing (and managing) with an empty list, so
  // only bail out entirely when there is nothing at all.
  if (bookmarks.length === 0 && collections.length === 0) {
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
      <CollectionBar
        collections={collections}
        counts={counts}
        total={bookmarks.length}
        active={collectionFilter}
        onSelect={setCollectionFilter}
        onCreate={onCreateCollection}
        onRename={onRenameCollection}
        onDelete={onDeleteCollection}
      />

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
        <EmptyState
          title={bookmarks.length === 0 ? "No bookmarks yet" : "No matches"}
          hint={
            bookmarks.length === 0
              ? "Save any tab from the Media view to keep it here."
              : "Try a different search, collection or tag."
          }
        />
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
