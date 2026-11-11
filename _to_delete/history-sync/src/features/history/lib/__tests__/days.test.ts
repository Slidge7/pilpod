import { describe, expect, it } from "vitest";
import { dayLabel, groupByDay, startOfLocalDay, startOfNextLocalDay } from "../days";

/** Local wall-clock time — the grouping is defined in the user's timezone. */
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

const row = (id: number, startedAtMs: number) => ({ id, startedAtMs });

describe("groupByDay", () => {
  const now = at(2026, 10, 28, 15);

  it("splits newest-first rows into consecutive local days", () => {
    const rows = [
      row(4, at(2026, 10, 28, 9)),
      row(3, at(2026, 10, 28, 0, 5)),
      row(2, at(2026, 10, 27, 23, 59)),
      row(1, at(2026, 10, 20, 8)),
    ];
    const groups = groupByDay(rows, now);
    expect(groups.map((g) => g.items.map((r) => r.id))).toEqual([[4, 3], [2], [1]]);
    expect(groups[0].label).toBe("Today");
    expect(groups[1].label).toBe("Yesterday");
    expect(groups[0].key).toBe("2026-10-28");
  });

  it("gives each day its full local range for 'remove day'", () => {
    const [group] = groupByDay([row(1, at(2026, 10, 28, 13))], now);
    expect(group.startMs).toBe(at(2026, 10, 28, 0));
    expect(group.endMs).toBe(at(2026, 10, 29, 0));
  });

  it("returns nothing for no rows", () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe("day boundaries", () => {
  it("start and next start bracket the timestamp", () => {
    const ts = at(2026, 3, 29, 1, 30);
    expect(startOfLocalDay(ts)).toBeLessThanOrEqual(ts);
    expect(startOfNextLocalDay(ts)).toBeGreaterThan(ts);
    expect(new Date(startOfNextLocalDay(ts)).getHours()).toBe(0);
  });
});

describe("dayLabel", () => {
  const now = at(2026, 10, 28, 15);

  it("labels older days with a date, adding the year only when it differs", () => {
    const sameYear = dayLabel(startOfLocalDay(at(2026, 10, 20)), now);
    const lastYear = dayLabel(startOfLocalDay(at(2025, 10, 20)), now);
    expect(sameYear).not.toMatch(/2026/);
    expect(lastYear).toMatch(/2025/);
  });
});
