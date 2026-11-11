import type { HistoryKind } from "../../history";

/**
 * Where Sky is, as plain data. No React here, so the rules are testable
 * and any part of the page — the sidebar, a keyboard shortcut, a search
 * result — moves around the same way.
 */

export const SECTION_IDS = ["live", "history", "bookmarks", "playlists", "blocked", "settings"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** The pages of the Settings section, in sidebar order. */
export const SETTINGS_PAGE_IDS = [
  "appearance",
  "wallpaper",
  "idle",
  "widget",
  "browsers",
  "data",
] as const;
export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number];

export function isSettingsPageId(value: unknown): value is SettingsPageId {
  return (
    typeof value === "string" && (SETTINGS_PAGE_IDS as readonly string[]).includes(value)
  );
}

export const DEFAULT_SECTION: SectionId = "live";

/**
 * What a section should show when it is navigated to — "the bookmarks
 * matching `lofi`", "the Work profile's tabs". Every field is optional; a
 * section applies the fields it understands and ignores the rest.
 */
export type SectionIntent = {
  search?: string;
  /** Live: narrow to one browser profile (`null` = every browser). */
  browserId?: string | null;
  /** Bookmarks: a collection id, the unfiled view, or `null` for all. */
  collectionId?: string | null;
  /** Playlists: open this playlist (`null` = the overview grid). */
  playlistId?: string | null;
  /** History: which list. */
  historyKind?: HistoryKind;
  /** Settings: which page. */
  settingsPage?: SettingsPageId;
};

export type Route = {
  section: SectionId;
  intent: SectionIntent | null;
  /**
   * Bumped on every navigation, so the same intent sent twice (the user
   * clicks "See all" again after changing the section's filter) still lands.
   */
  seq: number;
};

export function isSectionId(value: unknown): value is SectionId {
  return (
    typeof value === "string" && (SECTION_IDS as readonly string[]).includes(value)
  );
}

export function initialRoute(stored: unknown): Route {
  return {
    section: isSectionId(stored) ? stored : DEFAULT_SECTION,
    intent: null,
    seq: 0,
  };
}

export function navigate(
  route: Route,
  section: SectionId,
  intent: SectionIntent | null = null,
): Route {
  return { section, intent, seq: route.seq + 1 };
}
