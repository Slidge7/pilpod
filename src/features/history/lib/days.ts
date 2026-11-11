/**
 * Group newest-first history rows into local calendar days.
 *
 * Grouping happens on the client because "a day" is the user's local day; the
 * backend stores UTC milliseconds and stays timezone-agnostic. Each group also
 * carries its `[startMs, endMs)` range so "remove this day" can clear the whole
 * day on the backend — including rows not loaded yet.
 */

export interface DayGroup<T> {
  /** Stable React key: local `YYYY-MM-DD`. */
  key: string;
  label: string;
  startMs: number;
  endMs: number;
  items: T[];
}

/** Local midnight at or before `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight after `ms` — DST-safe (not `start + 24h`). */
export function startOfNextLocalDay(ms: number): number {
  const d = new Date(startOfLocalDay(ms));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** `"Today"`, `"Yesterday"`, or a locale date (`"Mon, Oct 26"`, year when not this year). */
export function dayLabel(dayStartMs: number, nowMs: number): string {
  const today = startOfLocalDay(nowMs);
  if (dayStartMs === today) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayStartMs === yesterday.getTime()) return "Yesterday";
  const sameYear = new Date(dayStartMs).getFullYear() === new Date(nowMs).getFullYear();
  return new Date(dayStartMs).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * Split rows (already newest-first) into consecutive day groups. Order is
 * preserved; a row is placed by its `startedAtMs`.
 */
export function groupByDay<T extends { startedAtMs: number }>(
  items: readonly T[],
  nowMs: number,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const key = dayKey(item.startedAtMs);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const startMs = startOfLocalDay(item.startedAtMs);
      group = {
        key,
        label: dayLabel(startMs, nowMs),
        startMs,
        endMs: startOfNextLocalDay(item.startedAtMs),
        items: [],
      };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
