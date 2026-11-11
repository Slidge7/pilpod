import { describe, expect, it } from "vitest";
import { UNFILED, type Bookmark } from "../../../../../vault";
import { indexBookmarks } from "../../../../search/lib/providers";
import { collectionTitle, selectBookmarks, type BookmarkViewQuery } from "../bookmarksView";

function bm(over: Partial<Bookmark> & { id: string }): Bookmark {
  return {
    url: `https://${over.id}.example/`,
    normalizedUrl: `${over.id}.example`,
    title: over.id,
    createdAtMs: 0,
    openCount: 0,
    pinned: false,
    tags: [],
    collectionIds: [],
    ...over,
  };
}

const bookmarks = [
  bm({ id: "alpha", title: "Alpha guide", createdAtMs: 1, tags: ["docs"], collectionIds: ["c1"] }),
  bm({ id: "beta", title: "Beta notes", createdAtMs: 3, openCount: 9 }),
  bm({ id: "gamma", title: "Guide to gamma", createdAtMs: 2, pinned: true, tags: ["docs"] }),
];
const vault = { version: 1, bookmarks, mediaItems: [], playlists: [], collections: [{ id: "c1", name: "Work", createdAtMs: 0, updatedAtMs: 0 }] };
const docs = indexBookmarks(vault);
const base: BookmarkViewQuery = { search: "", collection: null, tags: new Set(), sort: "recent" };

describe("selectBookmarks", () => {
  it("orders pinned first, then newest, with no search", () => {
    expect(selectBookmarks(bookmarks, docs, base).map((b) => b.id)).toEqual(["gamma", "beta", "alpha"]);
  });

  it("ranks by match when searching with the best-match sort", () => {
    const ids = selectBookmarks(bookmarks, docs, { ...base, search: "guide", sort: "best" }).map((b) => b.id);
    // "Guide to gamma" starts with the word; "Alpha guide" only contains it.
    expect(ids).toEqual(["gamma", "alpha"]);
  });

  it("falls back to newest when best match has nothing to rank", () => {
    expect(selectBookmarks(bookmarks, docs, { ...base, sort: "best" })[0].id).toBe("gamma");
  });

  it("filters by collection and tags", () => {
    expect(selectBookmarks(bookmarks, docs, { ...base, collection: "c1" }).map((b) => b.id)).toEqual(["alpha"]);
    expect(selectBookmarks(bookmarks, docs, { ...base, collection: UNFILED }).map((b) => b.id)).toEqual(["gamma", "beta"]);
    expect(selectBookmarks(bookmarks, docs, { ...base, tags: new Set(["docs"]) })).toHaveLength(2);
  });

  it("sorts by opens and title", () => {
    expect(selectBookmarks(bookmarks, docs, { ...base, sort: "opened" })[0].id).toBe("beta");
    expect(selectBookmarks(bookmarks, docs, { ...base, sort: "title" }).map((b) => b.id)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("names the collection filter", () => {
    expect(collectionTitle(null, vault.collections)).toBe("All bookmarks");
    expect(collectionTitle(UNFILED, vault.collections)).toBe("Unfiled");
    expect(collectionTitle("c1", vault.collections)).toBe("Work");
  });
});
