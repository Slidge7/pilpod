/**
 * The 11-character id of a YouTube video URL, or `null` for anything else.
 * Mirrors `youtube_block::logic::video_id` in Rust — change both together.
 */

const ID = /^[A-Za-z0-9_-]{11}$/;

function isYoutubeHost(host: string): boolean {
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  );
}

export function youtubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  const host = u.hostname.toLowerCase();
  const segments = u.pathname.split("/").filter(Boolean);
  let candidate: string | null | undefined = null;

  if (host === "youtu.be") {
    candidate = segments[0];
  } else if (isYoutubeHost(host)) {
    switch (segments[0]) {
      case "watch":
        candidate = u.searchParams.get("v");
        break;
      case "shorts":
      case "embed":
      case "live":
      case "v":
        candidate = segments[1];
        break;
    }
  }
  return candidate && ID.test(candidate) ? candidate : null;
}

/** Whether a tab URL can be blocked (shows the Block button). */
export function isBlockableUrl(url: string | null | undefined): boolean {
  return youtubeVideoId(url) !== null;
}
