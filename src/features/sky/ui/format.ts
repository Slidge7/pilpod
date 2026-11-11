/** Small display helpers shared by the sections. */

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** `"3:07"`, `"1:02:45"` — media lengths. */
export function formatLength(totalSecs: number | null | undefined): string | null {
  if (totalSecs == null || !Number.isFinite(totalSecs) || totalSecs <= 0) return null;
  const s = Math.round(totalSecs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** `"2 h 15 min"` / `"48 min"` — a playlist's total length. */
export function formatTotal(totalSecs: number): string | null {
  if (!(totalSecs > 0)) return null;
  const minutes = Math.round(totalSecs / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const RTF = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl
  ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  : null;

/** `"yesterday"`, `"3 days ago"`, `"just now"`. */
export function timeAgo(ms: number, now = Date.now()): string {
  const diff = Math.round((ms - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2629800],
    ["year", 31557600],
  ];
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let size = 60;
  for (const [u, s] of units) {
    if (abs >= s) {
      unit = u;
      size = s;
    }
  }
  const value = Math.round(diff / size);
  return RTF ? RTF.format(value, unit) : `${Math.abs(value)} ${unit}s ago`;
}
