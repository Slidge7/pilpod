import { describe, it, expect } from "vitest";
import {
  searchBookmarks,
  filterBookmarksByTags,
  orderBookmarks,
  collectTags,
  searchMediaItems,
  countByCollection,
  filterBookmarksByCollection,
  UNFILED,
} from "../vaultSearch";
import type { Bookmark, MediaItem } from "../../types";

function bm(over: Partial<Bookmark> & { id: string }): Bookmark {
  return {
    url: "https://example.com",
    normalizedUrl: "https://example.com",
    title: "Example",
    createdAtMs: 0,
    openCount: 0,
    pinned: false,
    tags: [],
    collectionIds: [],
    ...over,
  };
}

function mi(over: Partial<MediaItem> & { id: string }): MediaItem {
  return {
    url: "https://example.com",
    normalizedUrl: "https://example.com",
    pageTitle: "Page",
    kind: "unknown",
    addedAtMs: 0,
    playCount: 0,
    ...over,
  };
}

describe("searchBookmarks", () => {
  it("empty query returns all", () => {
    const list = [bm({ id: "a" }), bm({ id: "b" })];
    expect(searchBookmarks(list, "  ")).toHaveLength(2);
  });

  it("ranks exact title over url substring", () => {
    const exact = bm({ id: "exact", title: "Rust", url: "https://x.com" });
    const urlOnly = bm({ id: "url", title: "Other", url: "https://rust-lang.org" });
    const ranked = searchBookmarks([urlOnly, exact], "rust");
    expect(ranked[0].id).toBe("exact");
    expect(ranked.map((b) => b.id)).toContain("url");
  });

  it("matches tags", () => {
    const tagged = bm({ id: "t", title: "Nope", tags: ["docs"] });
    const ranked = searchBookmarks([tagged], "docs");
    expect(ranked).toHaveLength(1);
  });

  it("drops non-matches", () => {
    const ranked = searchBookmarks([bm({ id: "a", title: "Alpha" })], "zzz");
    expect(ranked).toHaveLength(0);
  });
});

describe("filterBookmarksByTags", () => {
  it("AND semantics across tags", () => {
    const both = bm({ id: "both", tags: ["a", "b"] });
    const one = bm({ id: "one", tags: ["a"] });
    const out = filterBookmarksByTags([both, one], new Set(["a", "b"]));
    expect(out.map((b) => b.id)).toEqual(["both"]);
  });

  it("empty tag set returns all", () => {
    expect(filterBookmarksByTags([bm({ id: "a" })], new Set())).toHaveLength(1);
  });
});

describe("filterBookmarksByCollection", () => {
  const filed = bm({ id: "filed", collectionIds: ["c1"] });
  const multi = bm({ id: "multi", collectionIds: ["c1", "c2"] });
  const unfiled = bm({ id: "unfiled" });
  const list = [filed, multi, unfiled];

  it("null returns every bookmark", () => {
    expect(filterBookmarksByCollection(list, null)).toHaveLength(3);
  });

  it("UNFILED returns only bookmarks in no collection", () => {
    expect(filterBookmarksByCollection(list, UNFILED).map((b) => b.id)).toEqual([
      "unfiled",
    ]);
  });

  it("an id returns every member, including multi-collection bookmarks", () => {
    expect(filterBookmarksByCollection(list, "c1").map((b) => b.id)).toEqual([
      "filed",
      "multi",
    ]);
    expect(filterBookmarksByCollection(list, "c2").map((b) => b.id)).toEqual(["multi"]);
    expect(filterBookmarksByCollection(list, "ghost")).toHaveLength(0);
  });
});

describe("countByCollection", () => {
  it("counts each membership and the unfiled bucket separately", () => {
    const { byId, unfiled } = countByCollection([
      bm({ id: "a", collectionIds: ["c1"] }),
      bm({ id: "b", collectionIds: ["c1", "c2"] }),
      bm({ id: "c" }),
      bm({ id: "d" }),
    ]);
    expect(byId.get("c1")).toBe(2);
    expect(byId.get("c2")).toBe(1);
    expect(unfiled).toBe(2);
  });
});

describe("orderBookmarks", () => {
  it("pinned first, then newest", () => {
    const list = [
      bm({ id: "old", createdAtMs: 1 }),
      bm({ id: "new", createdAtMs: 5 }),
      bm({ id: "pin", createdAtMs: 2, pinned: true }),
    ];
    expect(orderBookmarks(list).map((b) => b.id)).toEqual(["pin", "new", "old"]);
  });
});

describe("collectTags", () => {
  it("counts and sorts distinct tags", () => {
    const list = [bm({ id: "a", tags: ["rust", "docs"] }), bm({ id: "b", tags: ["rust"] })];
    expect(collectTags(list)).toEqual([
      { tag: "docs", count: 1 },
      { tag: "rust", count: 2 },
    ]);
  });
});

describe("searchMediaItems", () => {
  it("matches media title and artist", () => {
    const items = [
      mi({ id: "song", mediaTitle: "Lofi Beats", artist: "DJ X" }),
      mi({ id: "other", mediaTitle: "News", artist: "Anchor" }),
    ];
    expect(searchMediaItems(items, "lofi").map((m) => m.id)).toEqual(["song"]);
    expect(searchMediaItems(items, "anchor").map((m) => m.id)).toEqual(["other"]);
  });
});
