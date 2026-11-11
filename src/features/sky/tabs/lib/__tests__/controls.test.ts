import { describe, expect, it } from "vitest";
import { clock, isSavableUrl, isSeekable, seekBy, windowCollectionName } from "../controls";

describe("tab controls", () => {
  it("seeks inside the media", () => {
    expect(seekBy(5, -10, 100)).toBe(0);
    expect(seekBy(95, 10, 100)).toBe(100);
    expect(seekBy(20, 10, 100)).toBe(30);
    expect(seekBy(20, 10, 0)).toBe(30);
  });

  it("formats clock times", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(187.9)).toBe("3:07");
    expect(clock(3765)).toBe("1:02:45");
    expect(clock(undefined)).toBe("0:00");
    expect(clock(Number.NaN)).toBe("0:00");
  });

  it("only offers a seek bar for media with a length", () => {
    expect(isSeekable(300, true)).toBe(true);
    expect(isSeekable(300, undefined)).toBe(true);
    expect(isSeekable(300, false)).toBe(false);
    expect(isSeekable(0, true)).toBe(false);
    expect(isSeekable(Infinity, true)).toBe(false);
  });

  it("names a saved window and knows what can be saved", () => {
    const name = windowCollectionName("Personal", "Window 2", new Date(2026, 9, 30));
    expect(name.startsWith("Personal · Window 2 · ")).toBe(true);
    expect(isSavableUrl("https://x.dev")).toBe(true);
    expect(isSavableUrl("chrome://settings")).toBe(false);
  });
});
