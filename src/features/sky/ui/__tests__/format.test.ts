import { describe, expect, it } from "vitest";
import { formatLength, formatTotal, plural, timeAgo } from "../format";

describe("format", () => {
  it("pluralizes", () => {
    expect(plural(1, "tab")).toBe("1 tab");
    expect(plural(2, "tab")).toBe("2 tabs");
  });

  it("formats lengths", () => {
    expect(formatLength(187)).toBe("3:07");
    expect(formatLength(3765)).toBe("1:02:45");
    expect(formatLength(0)).toBeNull();
    expect(formatLength(null)).toBeNull();
    expect(formatTotal(2880)).toBe("48 min");
    expect(formatTotal(8100)).toBe("2 h 15 min");
    expect(formatTotal(7200)).toBe("2 h");
    expect(formatTotal(0)).toBeNull();
  });

  it("says how long ago", () => {
    const now = 1_000_000_000_000;
    expect(timeAgo(now - 10_000, now)).toBe("just now");
    expect(timeAgo(now - 3 * 86_400_000, now)).toMatch(/3 days ago/);
  });
});
