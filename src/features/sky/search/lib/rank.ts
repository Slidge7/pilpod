import type { SearchScope } from "./query";
import type { ResultGroup, ResultGroupId, SearchHit } from "./types";

/**
 * Turn each provider's ranked hits into the groups the panel shows.
 *
 * Groups are ordered by their best hit, so typing a playlist's name puts
 * Playlists first and typing a site puts Open tabs first — the top row is
 * always the most relevant thing PilPod knows, whichever kind it is.
 */

export const GROUP_LABEL: Record<ResultGroupId, string> = {
  commands: "Actions",
  tabs: "Open tabs",
  playlists: "Playlists & tracks",
  bookmarks: "Bookmarks",
  history: "History",
};

/** Which groups a scope shows. */
export const SCOPE_GROUPS: Record<SearchScope, readonly ResultGroupId[]> = {
  all: ["commands", "tabs", "playlists", "bookmarks", "history"],
  tabs: ["tabs"],
  playlists: ["playlists"],
  bookmarks: ["bookmarks"],
  history: ["history"],
};

/** Rows per group when every kind is shown; a single scope shows many more. */
export const LIMIT_MIXED = 5;
export const LIMIT_COMMANDS = 3;
export const LIMIT_SCOPED = 40;

export function buildGroups(
  hitsByGroup: Partial<Record<ResultGroupId, readonly SearchHit[]>>,
  scope: SearchScope,
): ResultGroup[] {
  const groups: ResultGroup[] = [];
  for (const id of SCOPE_GROUPS[scope]) {
    const hits = hitsByGroup[id] ?? [];
    if (hits.length === 0) continue;
    const limit =
      scope !== "all" ? LIMIT_SCOPED : id === "commands" ? LIMIT_COMMANDS : LIMIT_MIXED;
    groups.push({
      id,
      label: GROUP_LABEL[id],
      hits: hits.slice(0, limit),
      total: hits.length,
    });
  }
  // Stable sort: equal best scores keep the scope's natural order.
  return groups.sort((a, b) => b.hits[0].score - a.hits[0].score);
}

/** The rows in display order — what the arrow keys walk through. */
export function flattenGroups(groups: readonly ResultGroup[]): SearchHit[] {
  return groups.flatMap((g) => g.hits);
}
