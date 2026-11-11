import { describe, expect, it } from "vitest";
import type { MediaItem, Playlist } from "../../../../../vault";
import { filterPlaylists, summarizePlaylist, trackMatches, trackTitle } from "../playlistView";

function item(id: string, over: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    normalizedUrl: id,
    pageTitle: `${id} - YouTube`,
    kind: "video",
    addedAtMs: 0,
    playCount: 0,
    ...over,
  };
}

const items = [
  item("a", { mediaTitle: "So What", artist: "Miles Davis", durationSecs: 545, artworkUrl: "art-a" }),
  item("b", { mediaTitle: "Blue in Green", artist: "Miles Davis", durationSecs: 337, artworkUrl: "art-a" }),
  item("c", { pageTitle: "Rain sounds - YouTube", durationSecs: null }),
];
const mediaById = new Map(items.map((m) => [m.id, m]));
const jazz: Playlist = { id: "p1", name: "Jazz", createdAtMs: 0, updatedAtMs: 0, itemIds: ["a", "b", "gone"] };
const sleep: Playlist = { id: "p2", name: "Sleep", createdAtMs: 0, updatedAtMs: 0, itemIds: ["c"] };

describe("playlistView", () => {
  it("summarizes tracks, length and distinct artwork, skipping missing items", () => {
    const s = summarizePlaylist(jazz, mediaById);
    expect(s.tracks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(s.totalSecs).toBe(882);
    expect(s.artworks).toEqual(["art-a"]);
  });

  it("titles a track from the best field it has", () => {
    expect(trackTitle(items[0])).toBe("So What");
    expect(trackTitle(items[2])).toBe("Rain sounds - YouTube");
  });

  it("finds playlists by name or by the tracks they hold", () => {
    expect(filterPlaylists([jazz, sleep], mediaById, "").map((m) => m.matchingTracks)).toEqual([3, 1]);
    expect(filterPlaylists([jazz, sleep], mediaById, "miles")).toEqual([{ playlist: jazz, matchingTracks: 2 }]);
    expect(filterPlaylists([jazz, sleep], mediaById, "sleep")).toEqual([{ playlist: sleep, matchingTracks: 0 }]);
    expect(trackMatches(items[1], ["blue", "davis"])).toBe(true);
  });
});

describe("moveItem", () => {
  it("moves up, down and clamps", async () => {
    const { moveItem } = await import("../playlistView");
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b"], 1, 9)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});
