import type { MediaSessionDto } from "../../../types/media";

/** Convert WinRT 100-nanosecond ticks to "M:SS" display string. */
export function formatTicks(ticks: number): string {
  const sec = Math.max(0, ticks / 10_000_000);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Duration label for a GSMTC session, or null when no timeline is available. */
export function sessionDurationLabel(s: MediaSessionDto): string | null {
  if (s.timeline.endTicks <= 0) return null;
  return formatTicks(s.timeline.endTicks);
}
