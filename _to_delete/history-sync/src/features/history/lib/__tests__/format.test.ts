import { describe, expect, it } from "vitest";
import { formatDuration, hostOf } from "../format";

describe("formatDuration", () => {
  it("rounds browsing time to minutes", () => {
    expect(formatDuration(0)).toBe("<1m");
    expect(formatDuration(59_999)).toBe("<1m");
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
    expect(formatDuration(65 * 60_000)).toBe("1h 05m");
    expect(formatDuration(26 * 3_600_000)).toBe("26h 00m");
  });

  it("treats nonsense as under a minute", () => {
    expect(formatDuration(Number.NaN)).toBe("<1m");
    expect(formatDuration(-5)).toBe("<1m");
  });
});

describe("hostOf", () => {
  it("extracts the host and falls back to the raw string", () => {
    expect(hostOf("https://www.youtube.com/watch?v=1")).toBe("www.youtube.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
});
