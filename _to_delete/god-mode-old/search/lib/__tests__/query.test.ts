import { describe, expect, it } from "vitest";
import { effectiveScope, isEmptyQuery, parseQuery } from "../query";

describe("parseQuery", () => {
  it("splits words and keeps the free text", () => {
    const q = parseQuery("  Lofi   Beats ");
    expect(q.terms).toEqual(["lofi", "beats"]);
    expect(q.text).toBe("Lofi Beats");
  });

  it("keeps quoted phrases together, even unterminated", () => {
    expect(parseQuery('"lofi  beats" chill').terms).toEqual(["lofi beats", "chill"]);
    expect(parseQuery('"half open').terms).toEqual(["half open"]);
  });

  it("reads operators", () => {
    const q = parseQuery("in:bm site:www.YouTube.com/watch is:playing jazz");
    expect(q.scope).toBe("bookmarks");
    expect(q.site).toBe("youtube.com");
    expect([...q.flags]).toEqual(["playing"]);
    expect(q.terms).toEqual(["jazz"]);
    expect(q.text).toBe("jazz");
  });

  it("treats unknown operators as text and drops unfinished ones", () => {
    expect(parseQuery("note:milk").terms).toEqual(["note:milk"]);
    expect(parseQuery("in:nowhere").terms).toEqual(["in:nowhere"]);
    expect(parseQuery("jazz site:").terms).toEqual(["jazz"]);
  });

  it("folds accents", () => {
    expect(parseQuery("Beyoncé École").terms).toEqual(["beyonce", "ecole"]);
  });

  it("knows when it is empty and which scope applies", () => {
    expect(isEmptyQuery(parseQuery("   "))).toBe(true);
    expect(isEmptyQuery(parseQuery("is:audible"))).toBe(false);
    expect(effectiveScope(parseQuery("is:audible"), "history")).toBe("tabs");
    expect(effectiveScope(parseQuery("in:history x"), "all")).toBe("history");
    expect(effectiveScope(parseQuery("x"), "playlists")).toBe("playlists");
  });
});
