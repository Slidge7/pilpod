import { describe, expect, it } from "vitest";
import { DEFAULT_SECTION, initialRoute, isSectionId, navigate } from "../route";

describe("route", () => {
  it("restores a stored section and rejects anything else", () => {
    expect(initialRoute("bookmarks").section).toBe("bookmarks");
    expect(initialRoute("nope").section).toBe(DEFAULT_SECTION);
    expect(initialRoute(null).section).toBe(DEFAULT_SECTION);
    expect(isSectionId(42)).toBe(false);
  });

  it("bumps seq on every navigation, even to the same place", () => {
    const a = initialRoute("live");
    const b = navigate(a, "history", { search: "x" });
    const c = navigate(b, "history", { search: "x" });
    expect(b).toEqual({ section: "history", intent: { search: "x" }, seq: 1 });
    expect(c.seq).toBe(2);
  });
});
