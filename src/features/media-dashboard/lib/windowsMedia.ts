import type { MediaSessionDto } from "../../../types/media";

export function thumbSrc(s: MediaSessionDto): string | null {
  if (!s.thumbnailBase64) return null;
  const mime = s.thumbnailMime || "image/jpeg";
  return `data:${mime};base64,${s.thumbnailBase64}`;
}

export function winRowKey(s: MediaSessionDto): string {
  return `w:${s.sessionIndex}`;
}

export function channelSession(s: MediaSessionDto): string | null {
  const a = s.artist?.trim();
  if (a) return a;
  const sub = s.subtitle?.trim();
  return sub || null;
}

export function isSessionPlaying(s: MediaSessionDto): boolean {
  const st = (s.playbackStatus || "").toLowerCase();
  return st === "playing";
}
