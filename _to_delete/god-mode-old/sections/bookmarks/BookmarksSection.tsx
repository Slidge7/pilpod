import { useCallback, useDeferredValue, useMemo, useState } from "react";
import "./Bookmarks.css";
import {
  UNFILED,
  collectTags,
  countByCollection,
  exportVault,
  importVault,
  type Bookmark,
  type CollectionFilter,
} from "../../../vault";
import { useVaultData } from "../../data/GodModeData";
import { useSectionIntent } from "../../navigation/Navigation";
import { SectionSidebar } from "../../navigation/SidebarSlot";
import { indexBookmarks } from "../../search/lib/providers";
import { parseQuery } from "../../search/lib/query";
import { EmptyState } from "../../ui/EmptyState";
import { FilterInput } from "../../ui/FilterInput";
import { plural } from "../../ui/format";
import { SectionLayout } from "../../ui/SectionLayout";
import { BookmarkCard, type BookmarkActions } from "./components/BookmarkCard";
import {
  SORT_LABEL,
  collectionTitle,
  selectBookmarks,
  type BookmarkSort,
} from "./lib/bookmarksView";

/** Tags listed in the sidebar; the rest are reachable from the cards. */
const SIDEBAR_TAGS = 18;

/**
 * Bookmarks — everything saved in the vault, by collection and tag, with the
 * same search as the header. Saving happens where the tabs are (the dashboard
 * and Live); this section is for finding, opening and tidying.
 */
export default function BookmarksSection() {
  const api = useVaultData();
  const { vault } = api;

  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState<CollectionFilter>(null);
  const [tags, setTags] = useState<ReadonlySet<string>>(() => new Set());
  const [sort, setSort] = useState<BookmarkSort>("recent");
  const [userSorted, setUserSorted] = useState(false);

  // Searching switches to best match unless the user picked an order.
  const effectiveSort: BookmarkSort = !userSorted && search.trim() ? "best" : sort;

  useSectionIntent("bookmarks", (intent) => {
    if (intent.search !== undefined) setSearch(intent.search);
    if (intent.collectionId !== undefined) setCollection(intent.collectionId);
    setTags(new Set());
  });

  const docs = useMemo(() => indexBookmarks(vault), [vault]);
  // Memoized before deferring: a fresh object each render would make every
  // render look like a new query and re-run the filter in the background.
  const liveQuery = useMemo(
    () => ({ search, collection, tags, sort: effectiveSort }),
    [search, collection, tags, effectiveSort],
  );
  const query = useDeferredValue(liveQuery);
  const shown = useMemo(
    () => selectBookmarks(vault.bookmarks, docs, query),
    [vault.bookmarks, docs, query],
  );
  const terms = useMemo(() => parseQuery(query.search).terms, [query.search]);

  const counts = useMemo(() => countByCollection(vault.bookmarks), [vault.bookmarks]);
  const tagList = useMemo(
    () => collectTags(vault.bookmarks).sort((a, b) => b.count - a.count).slice(0, SIDEBAR_TAGS),
    [vault.bookmarks],
  );

  const toggleTag = useCallback(
    (tag: string) =>
      setTags((current) => {
        const next = new Set(current);
        if (next.has(tag)) next.delete(tag);
        else next.add(tag);
        return next;
      }),
    [],
  );

  const { openEntry, updateBookmark, removeBookmark } = api;
  const actions = useMemo<BookmarkActions>(
    () => ({
      open: (b: Bookmark) => void openEntry(b.url, b.normalizedUrl),
      togglePin: (b: Bookmark) => void updateBookmark({ id: b.id, pinned: !b.pinned }),
      remove: (b: Bookmark) => void removeBookmark(b.id),
      copy: async (b: Bookmark) => {
        try {
          await navigator.clipboard.writeText(b.url);
          return true;
        } catch {
          return false;
        }
      },
      toggleTag,
    }),
    [openEntry, updateBookmark, removeBookmark, toggleTag],
  );

  const total = vault.bookmarks.length;
  const filtered = search.trim() !== "" || collection !== null || tags.size > 0;

  return (
    <>
      <SectionSidebar>
        <nav className="gm-subnav" aria-label="Collections">
          <h2 className="gm-sidebar__heading">Collections</h2>
          <ul>
            <CollectionItem label="All bookmarks" glyph="∗" count={total} current={collection === null} onSelect={() => setCollection(null)} />
            <CollectionItem label="Unfiled" glyph="○" count={counts.unfiled} current={collection === UNFILED} onSelect={() => setCollection(UNFILED)} />
            {vault.collections.map((c) => (
              <CollectionItem
                key={c.id}
                label={c.name}
                glyph={c.emoji || c.name.charAt(0).toUpperCase()}
                count={counts.byId.get(c.id) ?? 0}
                current={collection === c.id}
                onSelect={() => setCollection(c.id)}
              />
            ))}
          </ul>
        </nav>
        {tagList.length > 0 ? (
          <section className="gm-sidebar__block" aria-label="Tags">
            <h2 className="gm-sidebar__heading">Tags</h2>
            <div className="gm-chips">
              {tagList.map(({ tag, count }) => (
                <button key={tag} type="button" className="gm-tag" aria-pressed={tags.has(tag)} onClick={() => toggleTag(tag)}>
                  #{tag} <span className="gm-tag__count">{count}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <section className="gm-sidebar__block" aria-label="Backup">
          <h2 className="gm-sidebar__heading">Backup</h2>
          <div className="gm-sidebar__row">
            <button type="button" className="gm-textbtn" onClick={() => void exportVault()}>
              Export vault
            </button>
            <button type="button" className="gm-textbtn" onClick={() => void importVault()}>
              Import
            </button>
          </div>
        </section>
      </SectionSidebar>

      <SectionLayout
        label="Bookmarks"
        title={collectionTitle(collection, vault.collections)}
        meta={filtered ? `${plural(shown.length, "bookmark")} of ${total}` : plural(total, "bookmark")}
        actions={
          <>
            <FilterInput value={search} onChange={setSearch} placeholder="Filter bookmarks" label="Filter bookmarks" />
            <label className="gm-sort">
              <span className="gm-visually-hidden">Sort by</span>
              <select
                className="gm-select"
                value={effectiveSort}
                onChange={(e) => {
                  setSort(e.target.value as BookmarkSort);
                  setUserSorted(true);
                }}
              >
                {(Object.keys(SORT_LABEL) as BookmarkSort[]).map((s) => (
                  <option key={s} value={s} disabled={s === "best" && !search.trim()}>
                    {SORT_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
        toolbar={
          tags.size > 0 ? (
            <div className="gm-chips">
              <span className="gm-toolbar__label">Tagged</span>
              {[...tags].map((tag) => (
                <button key={tag} type="button" className="gm-tag" aria-pressed="true" onClick={() => toggleTag(tag)}>
                  #{tag} ✕
                </button>
              ))}
              <button type="button" className="gm-textbtn" onClick={() => setTags(new Set())}>
                Clear tags
              </button>
            </div>
          ) : undefined
        }
      >
        {total === 0 ? (
          <EmptyState title="No bookmarks yet">
            Save a tab from the dashboard’s save menu and it appears here, searchable with everything else.
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState
            title="No bookmark matches"
            action={
              <button
                type="button"
                className="gm-btn"
                onClick={() => {
                  setSearch("");
                  setCollection(null);
                  setTags(new Set());
                }}
              >
                Show all bookmarks
              </button>
            }
          >
            Nothing here fits the current filter.
          </EmptyState>
        ) : (
          <div className="gm-bm-grid">
            {shown.map((b) => (
              <BookmarkCard key={b.id} bookmark={b} terms={terms} activeTags={tags} actions={actions} />
            ))}
          </div>
        )}
      </SectionLayout>
    </>
  );
}

function CollectionItem({
  label,
  glyph,
  count,
  current,
  onSelect,
}: {
  label: string;
  glyph: string;
  count: number;
  current: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button type="button" className="gm-subnav__item" aria-current={current ? "true" : undefined} onClick={onSelect}>
        <span className="gm-subnav__glyph" aria-hidden="true">
          {glyph}
        </span>
        <span className="gm-subnav__label">{label}</span>
        <span className="gm-subnav__count">{count}</span>
      </button>
    </li>
  );
}
