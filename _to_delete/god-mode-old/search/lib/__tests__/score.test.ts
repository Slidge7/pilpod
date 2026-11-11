import { describe, expect, it } from "vitest";
import { highlightRanges, matchQuality, scoreFields } from "../score";
import { fold, foldWithMap, hostMatchesSite, hostOf } from "../text";

describe("text", () => {
  it("folds case and accents", () => {
    expect(fold("Beyoncé")).toBe("beyonce");
    expect(fold("ÉCOLE")).toBe("ecole");
    expect(fold(null)).toBe("");
  });

  it("maps folded characters back to the original", () => {
    const decomposed = "Café au lait";
    const { text, map } = foldWithMap(decomposed);
    expect(text).toBe("cafe au lait");
    expect(map[4]).toBe(5); // the space after the combining mark
  });

  it("reads hosts and sites", () => {
    expect(hostOf("https://www.YouTube.com/watch?v=1")).toBe("youtube.com");
    expect(hostOf("chrome://settings")).toBeNull();
    expect(hostMatchesSite("music.youtube.com", "youtube.com")).toBe(true);
    expect(hostMatchesSite(null, "youtube.com")).toBe(false);
  });
});

describe("matchQuality", () => {
  it("prefers exact, then prefix, then word start, then anywhere", () => {
    const exact = matchQuality("jazz", "jazz");
    const prefix = matchQuality("jazz night", "jazz");
    const word = matchQuality("late jazz", "jazz");
    const inside = matchQuality("acidjazz", "jazz");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
    expect(matchQuality("blues", "jazz")).toBe(0);
  });

  it("finds a word-start occurrence after a mid-word one", () => {
    expect(matchQuality("acidjazz and jazz", "jazz")).toBe(matchQuality("late jazz", "jazz"));
  });
});

describe("scoreFields", () => {
  const doc = [
    { text: "lofi hip hop radio", weight: 1 },
    { text: "youtube.com", weight: 0.7 },
  ];

  it("requires every term", () => {
    expect(scoreFields(doc, ["lofi", "youtube"])).toBeGreaterThan(0);
    expect(scoreFields(doc, ["lofi", "spotify"])).toBe(0);
  });

  it("weights fields", () => {
    expect(scoreFields(doc, ["lofi"])).toBeGreaterThan(scoreFields(doc, ["youtube"]));
  });

  it("matches everything with no terms", () => {
    expect(scoreFields(doc, [])).toBeGreaterThan(0);
  });
});

describe("highlightRanges", () => {
  it("merges overlapping matches in order", () => {
    expect(highlightRanges("Jazz and more jazz", ["jazz", "and"])).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 8 },
      { start: 14, end: 18 },
    ]);
  });

  it("highlights the original characters of folded matches", () => {
    expect(highlightRanges("Beyoncé live", ["beyonce"])).toEqual([{ start: 0, end: 7 }]);
    expect(highlightRanges("Café!", ["cafe"])).toEqual([{ start: 0, end: 5 }]);
  });

  it("returns nothing without terms", () => {
    expect(highlightRanges("x", [])).toEqual([]);
  });
});
