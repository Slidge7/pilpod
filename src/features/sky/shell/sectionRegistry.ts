import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import {
  IconBlock,
  IconBookmark,
  IconGlobe,
  IconHistory,
  IconMusicNote,
  IconSliders,
} from "../../../shared/ui/icons";
import type { SectionId } from "../navigation/route";

/**
 * Every Sky section, in sidebar order. Adding a section is one entry
 * here plus its folder under `sections/` — the shell, navigation and
 * keyboard shortcuts pick it up from this list.
 *
 * Sections load lazily: the window paints with only the visible one parsed,
 * and the rest are fetched in the background right after (see `preload`).
 */
export type SectionDef = {
  id: SectionId;
  label: string;
  /** Tooltip / screen-reader description. */
  description: string;
  Icon: ComponentType<{ className?: string }>;
  load: () => Promise<{ default: ComponentType }>;
  View: LazyExoticComponent<ComponentType>;
};

function section(def: Omit<SectionDef, "View">): SectionDef {
  return { ...def, View: lazy(def.load) };
}

export const SECTIONS: readonly SectionDef[] = [
  section({
    id: "live",
    label: "Live",
    description: "Every browser, window and tab, as it is right now",
    Icon: IconGlobe,
    load: () => import("../sections/live/LiveSection"),
  }),
  section({
    id: "history",
    label: "History",
    description: "Pages visited and media played",
    Icon: IconHistory,
    load: () => import("../sections/history/HistorySection"),
  }),
  section({
    id: "bookmarks",
    label: "Bookmarks",
    description: "Everything saved in the vault",
    Icon: IconBookmark,
    load: () => import("../sections/bookmarks/BookmarksSection"),
  }),
  section({
    id: "playlists",
    label: "Playlists",
    description: "Your playlists and the player",
    Icon: IconMusicNote,
    load: () => import("../sections/playlists/PlaylistsSection"),
  }),
  section({
    id: "blocked",
    label: "Blocked",
    description: "YouTube videos you blocked, and what was skipped",
    Icon: IconBlock,
    load: () => import("../sections/blocked/BlockedSection"),
  }),
  section({
    id: "settings",
    label: "Settings",
    description: "Theme, wallpaper, idle mode, widget, browsers and data",
    Icon: IconSliders,
    load: () => import("../sections/settings/SettingsSection"),
  }),
];

/** Warm every section's chunk so the first switch is instant. */
export function preloadSections(): void {
  for (const s of SECTIONS) void s.load().catch(() => {});
}
