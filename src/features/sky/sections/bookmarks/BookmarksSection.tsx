import { useCallback, useDeferredValue, useMemo, useState } from "react";
import "./Bookmarks.css";
import {
  UNFILED,
  collectTags,
  countByCollection,
  exportVault,
  findCollectionByName,
  importVault,
  type Bookmark,
  type CollectionFilter,
} from "../../../vault";
import { useVaultData } from "../../data/SkyData";
import { useSectionIntent } from "../../navigation/Navigation";
import { SectionSidebar } from "../../navigation/SidebarSlot";
import { indexBookmarks } from "../../search/lib/providers";
import { parseQuery } from "../../search/lib/query";
import { ConfirmButton } from "../../ui/ConfirmButton";
import { EmptyState } from "../../ui/EmptyState";
import { FilterInput } from "../../ui/FilterInput";
import { InlineCreate, useRename } from "../../ui/InlineCreate";
import { IconPencil, IconTrash } from "../../../../shared/ui/icons";
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

  const { openEntry, updateBookmark, removeBookmark, createCollection, updateCollection, deleteCollection } = api;
  const actions = useMemo<BookmarkActions>(
    () => ({
      open: (b: Bookmark) => void openEntry(b.url, b.normalizedUrl),
      edit: (b: Bookmark, patch) => updateBookmark({ id: b.id, ...patch }),
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

  const selectedCollection =
    collection && collection !== UNFILED ? (vault.collections.find((c) => c.id === collection) ?? null) : null;
  const rename = useRename(selectedCollection?.name ?? "", (name) =>
    selectedCollection ? updateCollection(selectedCollection.id, { name }) : Promise.resolve(false),
  );

  const total = vault.bookmarks.length;
  const filtered = search.trim() !== "" || collection !== null || tags.size > 0;

  return (
    <>
      <SectionSidebar>
        <nav className="sky-subnav" aria-label="Collections">
          <h2 className="sky-sidebar__heading">Collections</h2>
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
          <InlineCreate
            label="New collection"
            placeholder="Collection name"
            onCreate={async (name) => {
              const existing = findCollectionByName(vault.collections, name);
              const id = existing?.id ?? (await createCollection(name));
              if (id) setCollection(id);
              return id !== null;
            }}
          />
        </nav>
        {tagList.length > 0 ? (
          <section className="sky-sidebar__block" aria-label="Tags">
            <h2 className="sky-sidebar__heading">Tags</h2>
            <div className="sky-chips">
              {tagList.map(({ tag, count }) => (
                <button key={tag} type="button" className="sky-tag" aria-pressed={tags.has(tag)} onClick={() => toggleTag(tag)}>
                  #{tag} <span className="sky-tag__count">{count}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <section className="sky-sidebar__block" aria-label="Backup">
          <h2 className="sky-sidebar__heading">Backup</h2>
          <div className="sky-sidebar__row">
            <button type="button" className="sky-textbtn" onClick={() => void exportVault()}>
              Export vault
            </button>
            <ConfirmButton
              className="sky-textbtn"
              confirmLabel="Replace the vault?"
              title="Load a vault file in place of everything saved now"
              onConfirm={() => void importVault()}
            >
              Import
            </ConfirmButton>
          </div>
        </section>
      </SectionSidebar>

      <SectionLayout
        label="Bookmarks"
        title={rename.input ?? collectionTitle(collection, vault.collections)}
        meta={filtered ? `${plural(shown.length, "bookmark")} of ${total}` : plural(total, "bookmark")}
        actions={
          <>
            {selectedCollection ? (
              <>
                <button type="button" className="sky-btn" onClick={rename.start} disabled={rename.editing}>
                  <IconPencil />
                  Rename
                </button>
                <ConfirmButton
                  className="sky-btn sky-btn--danger"
                  confirmLabel="Delete this collection?"
                  title="Delete the collection. Its bookmarks stay saved (in All bookmarks)."
                  onConfirm={() => {
                    void deleteCollection(selectedCollection.id);
                    setCollection(null);
                  }}
                >
                  <IconTrash />
                  Delete
                </ConfirmButton>
              </>
            ) : null}
            <FilterInput value={search} onChange={setSearch} placeholder="Filter bookmarks" label="Filter bookmarks" />
            <label className="sky-sort">
              <span className="sky-visually-hidden">Sort by</span>
              <select
                className="sky-select"
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
            <div className="sky-chips">
              <span className="sky-toolbar__label">Tagged</span>
              {[...tags].map((tag) => (
                <button key={tag} type="button" className="sky-tag" aria-pressed="true" onClick={() => toggleTag(tag)}>
                  #{tag} ✕
                </button>
              ))}
              <button type="button" className="sky-textbtn" onClick={() => setTags(new Set())}>
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
                className="sky-btn"
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
          <div className="sky-bm-grid">
            {shown.map((b) => (
              <BookmarkCard
                key={b.id}
                bookmark={b}
                terms={terms}
                activeTags={tags}
                collections={vault.collections}
                actions={actions}
              />
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
      <button type="button" className="sky-subnav__item" aria-current={current ? "true" : undefined} onClick={onSelect}>
        <span className="sky-subnav__glyph" aria-hidden="true">
          {glyph}
        </span>
        <span className="sky-subnav__label">{label}</span>
        <span className="sky-subnav__count">{count}</span>
      </button>
    </li>
  );
}
