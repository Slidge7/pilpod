import { describe, it, expect } from "vitest";
import {
  findCollectionByName,
  indexBookmarksByUrl,
  indexMediaIdsByUrl,
  indexPlaylistIdsByUrl,
} from "../vaultIndex";
import type { Bookmark, BookmarkCollection, MediaItem, Playlist } from "../../types";

function bm(id: string, normalizedUrl: string, collectionIds: string[] = []): Bookmark {
  return {
    id,
    url: `https://${normalizedUrl}`,
    normalizedUrl,
    title: id,
    createdAtMs: 0,
    openCount: 0,
    pinned: false,
    tags: [],
    collectionIds,
  };
}

function mi(id: string, normalizedUrl: string): MediaItem {
  return {
    id,
    url: `https://${normalizedUrl}`,
    normalizedUrl,
    pageTitle: id,
    kind: "unknown",
    addedAtMs: 0,
    playCount: 0,
  };
}

function pl(id: string, itemIds: string[]): Playlist {
  return { id, name: id, createdAtMs: 0, updatedAtMs: 0, itemIds };
}

function coll(id: string, name: string): BookmarkCollection {
  return { id, name, createdAtMs: 0, updatedAtMs: 0 };
}

describe("indexBookmarksByUrl", () => {
  it("maps normalized url to the bookmark", () => {
    const map = indexBookmarksByUrl([bm("b1", "a.com", ["c1"]), bm("b2", "b.com")]);
    expect(map.get("a.com")?.collectionIds).toEqual(["c1"]);
    expect(map.get("nope.com")).toBeUndefined();
    expect(map.size).toBe(2);
  });
});

describe("indexMediaIdsByUrl", () => {
  it("maps normalized url to the pooled item id", () => {
    expect(indexMediaIdsByUrl([mi("m1", "song.com")]).get("song.com")).toBe("m1");
  });
});

describe("indexPlaylistIdsByUrl", () => {
  it("collects every playlist holding a url", () => {
    const items = [mi("m1", "song.com"), mi("m2", "other.com")];
    const lists = [pl("p1", ["m1"]), pl("p2", ["m1", "m2"])];
    const map = indexPlaylistIdsByUrl(items, lists);
    expect([...(map.get("song.com") ?? [])].sort()).toEqual(["p1", "p2"]);
    expect([...(map.get("other.com") ?? [])]).toEqual(["p2"]);
  });

  it("skips ids with no pooled item and short-circuits when empty", () => {
    expect(indexPlaylistIdsByUrl([], [pl("p1", ["ghost"])]).size).toBe(0);
    expect(indexPlaylistIdsByUrl([mi("m1", "a.com")], []).size).toBe(0);
    // A dangling id in a real playlist must not throw or invent an entry.
    expect(indexPlaylistIdsByUrl([mi("m1", "a.com")], [pl("p1", ["ghost"])]).size).toBe(0);
  });
});

describe("findCollectionByName", () => {
  const list = [coll("c1", "Reading"), coll("c2", "Work")];

  it("matches case-insensitively and ignores surrounding space", () => {
    expect(findCollectionByName(list, "  reading ")?.id).toBe("c1");
  });

  it("returns null for a miss or a blank name", () => {
    expect(findCollectionByName(list, "Nope")).toBeNull();
    expect(findCollectionByName(list, "   ")).toBeNull();
  });
});
