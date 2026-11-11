import {
  UNFILED,
  filterBookmarksByCollection,
  filterBookmarksByTags,
  orderBookmarks,
  type Bookmark,
  type BookmarkCollection,
  type CollectionFilter,
} from "../../../../vault";
import { rankBookmarks, type indexBookmarks } from "../../../search/lib/providers";
import { parseQuery } from "../../../search/lib/query";

/**
 * The Bookmarks section's view model, as pure functions. The filter box uses
 * the universal search's scorer, so "show in God Mode" from search lands on
 * the same bookmarks, in the same order.
 */

export type BookmarkSort = "best" | "recent" | "opened" | "title";

export const SORT_LABEL: Record<BookmarkSort, string> = {
  best: "Best match",
  recent: "Newest",
  opened: "Most opened",
  title: "A–Z",
};

export type BookmarkViewQuery = {
  search: string;
  collection: CollectionFilter;
  tags: ReadonlySet<string>;
  sort: BookmarkSort;
};

type Docs = ReturnType<typeof indexBookmarks>;

function compareTitle(a: Bookmark, b: Bookmark): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

export function selectBookmarks(
  bookmarks: readonly Bookmark[],
  docs: Docs,
  query: BookmarkViewQuery,
): Bookmark[] {
  const parsed = parseQuery(query.search);
  const searching = parsed.terms.length > 0 || parsed.site !== null;

  let list: Bookmark[];
  let score: Map<string, number> | null = null;
  if (searching) {
    const ranked = rankBookmarks(docs, parsed);
    score = new Map(ranked.map((r) => [r.bookmark.id, r.score]));
    list = ranked.map((r) => r.bookmark);
  } else {
    list = [...bookmarks];
  }

  list = filterBookmarksByCollection(list, query.collection);
  list = filterBookmarksByTags(list, query.tags);

  const sort = query.sort === "best" && !score ? "recent" : query.sort;
  switch (sort) {
    case "best":
      return list.sort((a, b) => (score!.get(b.id) ?? 0) - (score!.get(a.id) ?? 0) || compareTitle(a, b));
    case "recent":
      return orderBookmarks(list);
    case "opened":
      return list.sort(
        (a, b) =>
          b.openCount - a.openCount ||
          (b.lastOpenedAtMs ?? 0) - (a.lastOpenedAtMs ?? 0) ||
          compareTitle(a, b),
      );
    case "title":
      return list.sort(compareTitle);
  }
}

/** The heading for the current collection filter. */
export function collectionTitle(
  filter: CollectionFilter,
  collections: readonly BookmarkCollection[],
): string {
  if (filter === null) return "All bookmarks";
  if (filter === UNFILED) return "Unfiled";
  return collections.find((c) => c.id === filter)?.name ?? "All bookmarks";
}
