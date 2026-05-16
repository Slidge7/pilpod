import type { BrowserTabMediaDto } from "../../../types/media";

export function channelBrowser(t: BrowserTabMediaDto): string | null {
  const a = t.artist?.trim();
  return a || null;
}

export function isBrowserPlaying(t: BrowserTabMediaDto): boolean {
  return t.playbackState === "playing";
}

export function groupBrowserTabsByProfile(
  tabs: BrowserTabMediaDto[],
): [string, BrowserTabMediaDto[]][] {
  const map = new Map<string, BrowserTabMediaDto[]>();
  const order: string[] = [];
  for (const t of tabs) {
    if (!map.has(t.browserId)) {
      order.push(t.browserId);
      map.set(t.browserId, []);
    }
    map.get(t.browserId)!.push(t);
  }
  return order.map((id) => [id, map.get(id)!]);
}

export function browserGroupLabel(
  browserId: string,
  tabs: BrowserTabMediaDto[],
): string {
  const name = tabs[0]?.browserName?.trim();
  if (name) return name;
  return `${browserId.slice(0, 8)}…`;
}

export function browserRowKey(t: BrowserTabMediaDto): string {
  return `b:${t.browserId}:${t.tabId}`;
}

export function faviconFromUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(u.hostname)}`;
  } catch {
    return null;
  }
}
