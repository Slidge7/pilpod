import type { BrowserTab } from "../../../types/media";

/**
 * Card-level rules: what a tab card shows, and when it needs to re-render.
 */

export type TabLifecycle = "sleeping" | "loading" | "crashed";

/** The lifecycle badge worth showing on a card, or `null` for a normal tab. */
export function tabLifecycle(
  tabState: string | undefined,
): TabLifecycle | null {
  const s = (tabState ?? "").toLowerCase();
  return s === "sleeping" || s === "loading" || s === "crashed" ? s : null;
}

/** Playback position as 0–1, or `null` when the media has no known length. */
export function mediaProgress(tab: BrowserTab): number | null {
  const duration = tab.media?.duration;
  if (duration == null || !(duration > 0)) return null;
  const position = Math.max(0, tab.media?.currentTime ?? 0);
  return Math.min(1, position / duration);
}

/** True when the tab is muted, by the browser or by PilPod's per-tab control. */
export function isTabMuted(tab: BrowserTab): boolean {
  return tab.muted === true || tab.media?.tabMuted === true;
}

/**
 * Whether two snapshots of a tab render the same card.
 *
 * The browser stream arrives as fresh objects several times a second while
 * anything plays, so reference equality would re-render every card on every
 * tick. This compares only what a card displays. Playback position is
 * compared to the whole second: that is the resolution of the time label, and
 * the progress bar cannot move visibly by less.
 */
export function sameCardTab(a: BrowserTab, b: BrowserTab): boolean {
  if (a === b) return true;
  if (
    a.tabId !== b.tabId ||
    a.windowId !== b.windowId ||
    a.url !== b.url ||
    a.title !== b.title ||
    a.favIconUrl !== b.favIconUrl ||
    a.faviconUrl !== b.faviconUrl ||
    a.tabState !== b.tabState ||
    a.active !== b.active ||
    a.audible !== b.audible ||
    a.muted !== b.muted ||
    a.pinned !== b.pinned
  ) {
    return false;
  }
  const ma = a.media;
  const mb = b.media;
  if (!ma || !mb) return ma == mb;
  return (
    ma.playbackState === mb.playbackState &&
    ma.title === mb.title &&
    ma.artist === mb.artist &&
    ma.artworkUrl === mb.artworkUrl &&
    ma.duration === mb.duration &&
    ma.tabMuted === mb.tabMuted &&
    ma.mediaMatchRule === mb.mediaMatchRule &&
    Math.floor(ma.currentTime ?? 0) === Math.floor(mb.currentTime ?? 0)
  );
}
