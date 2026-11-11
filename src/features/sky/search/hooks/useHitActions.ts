import { useMemo } from "react";
import { historyApi } from "../../../history";
import { captureBookmark } from "../../../vault";
import { isSavableUrl } from "../../tabs/lib/controls";
import { tabHasMediaControls, isTabPlaying } from "../../../media-dashboard";
import { errorText, syncBrowsers } from "../../data/commands";
import { useLiveBrowsers, usePlayer, useVaultData } from "../../data/SkyData";
import { useNavigation } from "../../navigation/Navigation";
import type { SectionId, SectionIntent, SettingsPageId } from "../../navigation/route";
import {
  applyAppearance,
  persistAppearance,
  readStoredAppearance,
} from "../../../../theme/appearance";
import type { ResultGroupId, SearchHit } from "../lib/types";

export type SecondaryAction = {
  id: string;
  label: string;
  icon: "play" | "pause" | "reveal" | "bookmark" | "bookmarked";
  run: () => void;
};

export type HitActions = {
  /** Enter / click: the obvious thing — show the tab, open the page, play. */
  primary: (hit: SearchHit) => void;
  /** Ctrl+Enter: show the result in its Sky section. */
  reveal: (hit: SearchHit, text: string) => void;
  /** Extra buttons on a row, e.g. pause a playing tab without leaving search. */
  secondary: (hit: SearchHit) => SecondaryAction[];
  /** "See all" on a group. */
  seeAll: (group: ResultGroupId, text: string) => void;
};

const GROUP_SECTION: Record<Exclude<ResultGroupId, "commands">, SectionId> = {
  tabs: "live",
  playlists: "playlists",
  bookmarks: "bookmarks",
  history: "history",
};

/**
 * Flip the theme for every window: applied here, persisted for the others
 * (they follow the stored value as it changes).
 */
function toggleTheme() {
  const next = readStoredAppearance() === "dark" ? "light" : "dark";
  applyAppearance(next);
  persistAppearance(next);
}

function logFailure(what: string) {
  return (err: unknown) => console.error(`[sky] ${what} failed:`, errorText(err));
}

/**
 * The one place a search result becomes an action. Rows only describe what
 * they are (`hit.target`); everything they can do is decided here, from the
 * same controls the rest of Sky uses.
 */
export function useHitActions(): HitActions {
  const { controls, browsers } = useLiveBrowsers();
  const vault = useVaultData();
  const player = usePlayer();
  const { navigate } = useNavigation();

  const { focusTab, toggleTab, pauseAll, muteAll, resetAllVolumes, setError } = controls;
  const { openEntry, isSaved, bookmarkFor, saveToCollection, removeBookmark } = vault;
  const { start } = player;

  return useMemo<HitActions>(() => {
    const primary = (hit: SearchHit) => {
      const t = hit.target;
      switch (t.type) {
        case "tab":
          void focusTab(t.tab, t.browserId, t.browserName);
          return;
        case "bookmark":
          void openEntry(t.bookmark.url, t.bookmark.normalizedUrl);
          return;
        case "track":
          void openEntry(t.item.url, t.item.normalizedUrl);
          return;
        case "playlist":
          navigate("playlists", { playlistId: t.playlist.id });
          return;
        case "page":
          historyApi.open(t.visit.url).catch(logFailure("open history page"));
          return;
        case "play":
          historyApi.open(t.play.url).catch(logFailure("open history media"));
          return;
        case "command": {
          const c = t.command;
          if (c.startsWith("go:")) navigate(c.slice(3) as SectionId);
          else if (c.startsWith("settings:"))
            navigate("settings", { settingsPage: c.slice(9) as SettingsPageId });
          else if (c === "toggle-theme") toggleTheme();
          else if (c === "sync") syncBrowsers().catch((e: unknown) => setError(errorText(e)));
          else if (c === "pause-all") void pauseAll();
          else if (c === "mute-all") void muteAll();
          else if (c === "reset-volumes") void resetAllVolumes();
          return;
        }
      }
    };

    const reveal = (hit: SearchHit, text: string) => {
      const t = hit.target;
      const search = text.trim();
      const intent: SectionIntent = { search };
      switch (t.type) {
        case "tab":
          navigate("live", { search, browserId: t.browserId });
          return;
        case "bookmark":
          navigate("bookmarks", { ...intent, collectionId: null });
          return;
        case "playlist":
        case "track":
          navigate("playlists", { playlistId: t.playlist.id });
          return;
        case "page":
          navigate("history", { ...intent, historyKind: "pages" });
          return;
        case "play":
          navigate("history", { ...intent, historyKind: "media" });
          return;
        case "command":
          primary(hit);
          return;
      }
    };

    const secondary = (hit: SearchHit): SecondaryAction[] => {
      const t = hit.target;
      if (t.type === "tab") {
        const out: SecondaryAction[] = [];
        if (tabHasMediaControls(t.tab)) {
          const playing = isTabPlaying(t.tab);
          out.push({
            id: "toggle",
            label: playing ? "Pause" : "Play",
            icon: playing ? "pause" : "play",
            run: () => toggleTab(t.tab, t.browserId),
          });
        }
        if (isSavableUrl(t.tab.url)) {
          const saved = isSaved(t.tab.url);
          out.push({
            id: "save",
            label: saved ? "Remove bookmark" : "Bookmark this tab",
            icon: saved ? "bookmarked" : "bookmark",
            run: () => {
              const existing = bookmarkFor(t.tab.url);
              if (existing) {
                void removeBookmark(existing.id);
                return;
              }
              const b = browsers.find((x) => x.id === t.browserId);
              void saveToCollection(
                captureBookmark(
                  t.tab,
                  b ? { osBrowserId: b.osBrowserId, displayName: b.displayName, profileLabel: b.profileLabel ?? null } : undefined,
                ),
                null,
              );
            },
          });
        }
        return out;
      }
      if (t.type === "playlist" && t.playlist.itemIds.length > 0) {
        return [
          {
            id: "play",
            label: "Play in PilPod",
            icon: "play",
            run: () => void start(t.playlist.id, { target: "inApp" }),
          },
        ];
      }
      return [];
    };

    const seeAll = (group: ResultGroupId, text: string) => {
      if (group === "commands") return;
      const section = GROUP_SECTION[group];
      navigate(section, section === "bookmarks" ? { search: text, collectionId: null } : { search: text });
    };

    return { primary, reveal, secondary, seeAll };
  }, [
    focusTab,
    toggleTab,
    pauseAll,
    muteAll,
    resetAllVolumes,
    setError,
    openEntry,
    isSaved,
    bookmarkFor,
    saveToCollection,
    removeBookmark,
    browsers,
    start,
    navigate,
  ]);
}
