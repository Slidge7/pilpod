/** Display helpers for history rows. Pure; locale comes from the runtime. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** `"example.com"` — the URL itself when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Wall-clock time of day in the user's locale (`"14:05"` / `"2:05 PM"`). */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Compact duration: `"<1m"`, `"12m"`, `"1h 05m"`. Durations here are browsing
 * time, so seconds are noise — anything under a minute reads as `"<1m"`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE) return "<1m";
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
