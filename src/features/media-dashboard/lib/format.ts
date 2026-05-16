import type { MediaSessionDto } from "../../../types/media";

export function formatTicks(ticks: number): string {
  const sec = Math.max(0, ticks / 10_000_000);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatMediaSeconds(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function sessionDurationLabel(s: MediaSessionDto): string | null {
  if (s.timeline.endTicks <= 0) return null;
  return formatTicks(s.timeline.endTicks);
}
