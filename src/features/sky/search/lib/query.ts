import { fold } from "./text";

/**
 * The search box's little language.
 *
 *   lofi beats            every word must match (in any field)
 *   "lofi beats"          an exact phrase
 *   site:youtube.com      only results from that site (subdomains too)
 *   in:bookmarks          only one kind of result (tabs, bookmarks,
 *                         playlists, history)
 *   is:playing            live-tab states: playing, audible, pinned, media
 *
 * Unknown operators stay ordinary text, so pasting "note: buy milk" or a URL
 * with a colon never silently drops words.
 */

export const SEARCH_SCOPES = ["all", "tabs", "playlists", "bookmarks", "history"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export const TAB_FLAGS = ["playing", "audible", "pinned", "media"] as const;
export type TabFlag = (typeof TAB_FLAGS)[number];

export type ParsedQuery = {
  /** Free text with operators removed — what the backend history search gets. */
  text: string;
  /** Folded words and phrases; every one must match. */
  terms: string[];
  /** From `in:`; `null` when the query does not say. */
  scope: SearchScope | null;
  /** From `site:`, folded and without `www.`. */
  site: string | null;
  flags: ReadonlySet<TabFlag>;
};

const SCOPE_ALIASES: Record<string, SearchScope> = {
  all: "all",
  tab: "tabs",
  tabs: "tabs",
  live: "tabs",
  bookmark: "bookmarks",
  bookmarks: "bookmarks",
  saved: "bookmarks",
  bm: "bookmarks",
  playlist: "playlists",
  playlists: "playlists",
  pl: "playlists",
  track: "playlists",
  tracks: "playlists",
  history: "history",
  hist: "history",
};

const TOKEN = /"([^"]*)"?|(\S+)/g;

export function parseQuery(raw: string): ParsedQuery {
  const textParts: string[] = [];
  const terms: string[] = [];
  const flags = new Set<TabFlag>();
  let scope: SearchScope | null = null;
  let site: string | null = null;

  for (const match of raw.matchAll(TOKEN)) {
    const phrase = match[1];
    if (phrase !== undefined) {
      const folded = fold(phrase).trim().replace(/\s+/g, " ");
      if (folded) {
        terms.push(folded);
        textParts.push(phrase.trim());
      }
      continue;
    }

    const word = match[2];
    const colon = word.indexOf(":");
    if (colon > 0) {
      const key = word.slice(0, colon).toLowerCase();
      const value = fold(word.slice(colon + 1));
      if (key === "in" && SCOPE_ALIASES[value]) {
        scope = SCOPE_ALIASES[value];
        continue;
      }
      if (key === "site" && value) {
        site = value.replace(/^www\./, "").replace(/\/.*$/, "");
        continue;
      }
      if (key === "is" && (TAB_FLAGS as readonly string[]).includes(value)) {
        flags.add(value as TabFlag);
        continue;
      }
    }
    // `in:`/`site:` typed but not finished yet: drop it rather than search for it.
    if (/^(in|site|is):$/i.test(word)) continue;

    textParts.push(word);
    terms.push(fold(word));
  }

  return { text: textParts.join(" "), terms, scope, site, flags };
}

/** True when nothing narrows the results — the panel shows its start page. */
export function isEmptyQuery(q: ParsedQuery): boolean {
  return q.terms.length === 0 && q.site === null && q.flags.size === 0;
}

/** `is:` flags describe live tabs; with any of them only tabs can match. */
export function effectiveScope(q: ParsedQuery, picked: SearchScope): SearchScope {
  if (q.flags.size > 0) return "tabs";
  return q.scope ?? picked;
}
