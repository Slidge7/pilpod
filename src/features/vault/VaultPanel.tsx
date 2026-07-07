import { useMemo, useState } from "react";
import "./Vault.css";
import type { DetectedBrowser } from "../../types/media";
import type { Bookmark, MediaItem, Playlist } from "./types";
import type { VaultApi } from "./hooks/useVault";
import { BookmarkList } from "./components/BookmarkList";
import { PlaylistList } from "./components/PlaylistList";
import { PlaylistDetail } from "./components/PlaylistDetail";
import { AddToPlaylistMenu } from "./components/AddToPlaylistMenu";
import { SaveTabButton } from "./components/SaveTabButton";
import { EmptyState } from "./components/EmptyState";
import { captureBookmark, captureMedia } from "./lib/capture";
import { normalizeUrl } from "./lib/normalizeUrl";
import {
  collectActiveMediaTabs,
  faviconFromUrl,
} from "../media-dashboard/lib/browserMedia";
import { IconBookmark, IconMusicNote } from "../../shared/ui/icons";
import { VAULT_OPEN_ENABLED } from "./constants";
import { exportVault, importVault } from "./lib/backup";

type SubView = "bookmarks" | "playlists";

export function VaultPanel({
  api,
  browsers,
  forceSub,
}: {
  api: VaultApi;
  browsers: DetectedBrowser[];
  /** When set, locks the panel to this sub-view and hides the internal tab bar. */
  forceSub?: SubView;
}) {
  const [internalSub, setInternalSub] = useState<SubView>("bookmarks");
  const sub = forceSub ?? internalSub;
  const setSub = setInternalSub;
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [savingOpenTabs, setSavingOpenTabs] = useState(false);

  const { vault } = api;

  const browserById = useMemo(
    () => new Map(browsers.map((b) => [b.id, b])),
    [browsers],
  );

  const mediaById = useMemo(
    () => new Map(vault.mediaItems.map((m) => [m.id, m])),
    [vault.mediaItems],
  );

  const openPlaylist = openPlaylistId
    ? vault.playlists.find((p) => p.id === openPlaylistId) ?? null
    : null;

  const openPlaylistItems: MediaItem[] = useMemo(() => {
    if (!openPlaylist) return [];
    return openPlaylist.itemIds
      .map((id) => mediaById.get(id))
      .filter((m): m is MediaItem => m != null);
  }, [openPlaylist, mediaById]);

  // ── Bookmark handlers ─────────────────────────────────────────────────
  const openBookmark = (b: Bookmark) => void api.openEntry(b.url, b.normalizedUrl);
  const togglePin = (b: Bookmark) => void api.updateBookmark({ id: b.id, pinned: !b.pinned });

  // ── Playlist handlers ─────────────────────────────────────────────────
  const openMedia = (m: MediaItem) => void api.openEntry(m.url, m.normalizedUrl);

  const playingTabs = useMemo(
    () => collectActiveMediaTabs(browsers),
    [browsers],
  );

  const allOpenTabs = useMemo(
    () =>
      browsers
        .filter((b) => b.extensionConnected)
        .flatMap((b) => b.tabs.map((tab) => ({ browser: b, tab }))),
    [browsers],
  );

  return (
    <section
      className="pilpod-vault-panel"
      role="tabpanel"
      id="panel-vault"
      aria-labelledby="tab-vault"
    >
      {!forceSub && <div className="pilpod-vault-subtabs" role="tablist" aria-label="Vault views">
        <button
          type="button"
          role="tab"
          aria-selected={sub === "bookmarks"}
          className={[
            "pilpod-vault-subtab",
            sub === "bookmarks" ? "pilpod-vault-subtab--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setSub("bookmarks")}
        >
          <IconBookmark className="pilpod-icon--sm" /> Bookmarks
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sub === "playlists"}
          className={[
            "pilpod-vault-subtab",
            sub === "playlists" ? "pilpod-vault-subtab--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => {
            setSub("playlists");
            setOpenPlaylistId(null);
          }}
        >
          <IconMusicNote className="pilpod-icon--sm" /> Playlists
        </button>
        <span className="pilpod-vault-subtabs__spacer" />
        <button
          type="button"
          className="pilpod-vault-icon-btn"
          title="Export vault to a file"
          aria-label="Export vault"
          onClick={() => void exportVault()}
        >
          ⤓
        </button>
        <button
          type="button"
          className="pilpod-vault-icon-btn"
          title="Import vault from a file"
          aria-label="Import vault"
          onClick={() => void importVault()}
        >
          ⤒
        </button>
      </div>}

      {sub === "bookmarks" ? (
        <>
          <div className="pilpod-vault-savebar">
            <button
              type="button"
              className="pilpod-vault-btn"
              aria-expanded={savingOpenTabs}
              onClick={() => setSavingOpenTabs((v) => !v)}
            >
              {savingOpenTabs ? "Done" : "Save an open tab"}
            </button>
          </div>

          {savingOpenTabs ? (
            <OpenTabsSaver
              tabs={allOpenTabs}
              isSaved={(url) => api.savedUrlSet.has(normalizeUrl(url))}
              onToggle={(entry) =>
                void api.toggleBookmark(
                  captureBookmark(entry.tab, {
                    osBrowserId: entry.browser.osBrowserId,
                    profileLabel: entry.browser.profileLabel,
                    displayName: entry.browser.displayName,
                  }),
                )
              }
            />
          ) : null}

          <BookmarkList
            bookmarks={vault.bookmarks}
            canOpen={VAULT_OPEN_ENABLED}
            onOpen={openBookmark}
            onTogglePin={togglePin}
            onRemove={(id) => void api.removeBookmark(id)}
            onSaveEdit={(patch) => void api.updateBookmark(patch)}
          />
        </>
      ) : openPlaylist ? (
        <>
          <PlaylistDetail
            playlist={openPlaylist}
            items={openPlaylistItems}
            canOpen={VAULT_OPEN_ENABLED}
            onBack={() => setOpenPlaylistId(null)}
            onOpenItem={openMedia}
            onRemoveItem={(itemId) => void api.removeFromPlaylist(openPlaylist.id, itemId)}
            onReorder={(itemIds) => void api.reorderPlaylist(openPlaylist.id, itemIds)}
            onRename={(name) => void api.updatePlaylist(openPlaylist.id, { name })}
          />
          <PlayingTabsAdder
            playing={playingTabs}
            onAdd={(browserId, tab) => {
              const browser = browserById.get(browserId);
              void api.addMediaToPlaylist(
                openPlaylist.id,
                captureMedia(tab, {
                  osBrowserId: browser?.osBrowserId,
                  profileLabel: browser?.profileLabel,
                  displayName: browser?.displayName,
                }),
              );
            }}
          />
        </>
      ) : (
        <>
          <NowPlayingAdder
            playing={playingTabs}
            playlists={vault.playlists}
            containingIdsFor={(url) => {
              const normalized = normalizeUrl(url);
              const item = vault.mediaItems.find((m) => m.normalizedUrl === normalized);
              if (!item) return new Set<string>();
              return new Set(
                vault.playlists.filter((p) => p.itemIds.includes(item.id)).map((p) => p.id),
              );
            }}
            onAdd={async (browserId, tab, playlistId) => {
              const browser = browserById.get(browserId);
              await api.addMediaToPlaylist(
                playlistId,
                captureMedia(tab, {
                  osBrowserId: browser?.osBrowserId,
                  profileLabel: browser?.profileLabel,
                  displayName: browser?.displayName,
                }),
              );
            }}
            onCreateAndAdd={async (browserId, tab, name) => {
              const id = await api.createPlaylist(name);
              if (!id) return;
              const browser = browserById.get(browserId);
              await api.addMediaToPlaylist(
                id,
                captureMedia(tab, {
                  osBrowserId: browser?.osBrowserId,
                  profileLabel: browser?.profileLabel,
                  displayName: browser?.displayName,
                }),
              );
            }}
          />
          <PlaylistList
            playlists={vault.playlists}
            itemCountFor={(p: Playlist) => p.itemIds.length}
            onOpen={(p) => setOpenPlaylistId(p.id)}
            onCreate={(name, emoji) => void api.createPlaylist(name, emoji)}
            onDelete={(id) => void api.deletePlaylist(id)}
          />
        </>
      )}
    </section>
  );
}

/** "Now playing" tabs with an "Add to…" popover (uses AddToPlaylistMenu). */
function NowPlayingAdder({
  playing,
  playlists,
  containingIdsFor,
  onAdd,
  onCreateAndAdd,
}: {
  playing: Array<{ browserId: string; browserDisplayName: string; tab: import("../../types/media").BrowserTab }>;
  playlists: Playlist[];
  containingIdsFor: (url: string) => ReadonlySet<string>;
  onAdd: (browserId: string, tab: import("../../types/media").BrowserTab, playlistId: string) => void;
  onCreateAndAdd: (browserId: string, tab: import("../../types/media").BrowserTab, name: string) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (playing.length === 0) return null;

  return (
    <div className="pilpod-vault-adder">
      <div className="pilpod-vault-adder__head">Now playing</div>
      <ul className="pilpod-vault-rows pilpod-vault-rows--compact">
        {playing.map((e) => {
          const key = `${e.browserId}:${e.tab.tabId}`;
          const title = e.tab.media?.title?.trim() || e.tab.title?.trim() || e.tab.url;
          return (
            <li key={key} className="pilpod-vault-row">
              <div className="pilpod-vault-row__main">
                <div className="pilpod-vault-row__thumb pilpod-vault-row__thumb--emoji" aria-hidden>
                  <IconMusicNote className="pilpod-icon--sm" />
                </div>
                <div className="pilpod-vault-row__body pilpod-vault-row__body--static">
                  <span className="pilpod-vault-row__title">{title}</span>
                  <span className="pilpod-vault-row__url">
                    {e.tab.media?.artist?.trim() || e.browserDisplayName}
                  </span>
                </div>
                <div className="pilpod-vault-row__actions">
                  <button
                    type="button"
                    className="pilpod-vault-btn"
                    aria-expanded={openKey === key}
                    onClick={() => setOpenKey((k) => (k === key ? null : key))}
                  >
                    Add to…
                  </button>
                </div>
              </div>
              {openKey === key ? (
                <AddToPlaylistMenu
                  playlists={playlists}
                  containingIds={containingIdsFor(e.tab.url ?? "")}
                  onPick={(playlistId) => {
                    onAdd(e.browserId, e.tab, playlistId);
                    setOpenKey(null);
                  }}
                  onCreate={(name) => {
                    onCreateAndAdd(e.browserId, e.tab, name);
                    setOpenKey(null);
                  }}
                  onClose={() => setOpenKey(null)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Compact list of open tabs, each with a save/unsave toggle. */
function OpenTabsSaver({
  tabs,
  isSaved,
  onToggle,
}: {
  tabs: Array<{ browser: DetectedBrowser; tab: import("../../types/media").BrowserTab }>;
  isSaved: (url: string) => boolean;
  onToggle: (entry: { browser: DetectedBrowser; tab: import("../../types/media").BrowserTab }) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = query
    ? tabs.filter(
        (e) =>
          (e.tab.title ?? "").toLowerCase().includes(query) ||
          (e.tab.url ?? "").toLowerCase().includes(query),
      )
    : tabs;

  if (tabs.length === 0) {
    return (
      <EmptyState
        title="No open tabs"
        hint="Connect a browser with the PilPod extension to save its tabs."
      />
    );
  }

  return (
    <div className="pilpod-vault-saver">
      <div className="pilpod-vault-searchbar">
        <span className="pilpod-vault-searchbar__icon" aria-hidden>⌕</span>
        <input
          type="search"
          className="pilpod-vault-searchbar__input"
          placeholder="Filter open tabs…"
          value={q}
          aria-label="Filter open tabs"
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ul className="pilpod-vault-rows pilpod-vault-rows--compact">
        {filtered.slice(0, 100).map((e) => {
          const fav =
            e.tab.favIconUrl?.trim() ||
            e.tab.faviconUrl?.trim() ||
            faviconFromUrl(e.tab.url ?? "") ||
            null;
          return (
            <li key={`${e.browser.id}:${e.tab.tabId}`} className="pilpod-vault-row">
              <div className="pilpod-vault-row__main">
                <div className="pilpod-vault-row__thumb">
                  {fav ? (
                    <img src={fav} alt="" width={20} height={20} loading="lazy" decoding="async" />
                  ) : (
                    <span className="pilpod-vault-row__thumb-fallback" aria-hidden />
                  )}
                </div>
                <div className="pilpod-vault-row__body pilpod-vault-row__body--static">
                  <span className="pilpod-vault-row__title">{e.tab.title?.trim() || "Untitled"}</span>
                  <span className="pilpod-vault-row__url">{e.browser.displayName}</span>
                </div>
                <div className="pilpod-vault-row__actions">
                  <SaveTabButton
                    saved={isSaved(e.tab.url ?? "")}
                    onToggle={() => onToggle(e)}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Lists tabs currently playing media, each with an "add to this playlist" button. */
function PlayingTabsAdder({
  playing,
  onAdd,
}: {
  playing: Array<{ browserId: string; browserDisplayName: string; tab: import("../../types/media").BrowserTab }>;
  onAdd: (browserId: string, tab: import("../../types/media").BrowserTab) => void;
}) {
  if (playing.length === 0) return null;
  return (
    <div className="pilpod-vault-adder">
      <div className="pilpod-vault-adder__head">Playing now</div>
      <ul className="pilpod-vault-rows pilpod-vault-rows--compact">
        {playing.map((e) => {
          const title = e.tab.media?.title?.trim() || e.tab.title?.trim() || e.tab.url;
          return (
            <li key={`${e.browserId}:${e.tab.tabId}`} className="pilpod-vault-row">
              <div className="pilpod-vault-row__main">
                <div className="pilpod-vault-row__thumb pilpod-vault-row__thumb--emoji" aria-hidden>
                  <IconMusicNote className="pilpod-icon--sm" />
                </div>
                <div className="pilpod-vault-row__body pilpod-vault-row__body--static">
                  <span className="pilpod-vault-row__title">{title}</span>
                  <span className="pilpod-vault-row__url">
                    {e.tab.media?.artist?.trim() || e.browserDisplayName}
                  </span>
                </div>
                <div className="pilpod-vault-row__actions">
                  <button
                    type="button"
                    className="pilpod-vault-btn pilpod-vault-btn--primary"
                    onClick={() => onAdd(e.browserId, e.tab)}
                  >
                    Add
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
