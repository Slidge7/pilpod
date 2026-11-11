import { useCallback, useMemo } from "react";
import type { BrowserTab } from "../../../types/media";
import type { VaultApi } from "./useVault";
import { captureBookmark, captureMedia, type CaptureBrowser } from "../lib/capture";
import { findCollectionByName } from "../lib/vaultIndex";

/**
 * "Where is this tab saved, and file it somewhere" — every read and write a
 * save menu needs, for one tab.
 *
 * Shared by the dashboard's save button and PilPod Sky's save menu so both
 * follow the same rules:
 *   * "All bookmarks" saves when unsaved and removes the bookmark when saved.
 *   * Picking a collection files the tab there (saving it first if needed);
 *     picking it again unfiles it but keeps the bookmark.
 *   * Picking a playlist adds the media, picking it again removes it.
 *   * Creating a collection that already exists (any case) reuses it.
 *
 * All lookups are the vault's O(1) indexes, so a menu per tab row is cheap.
 */
export function useSaveTargets(api: VaultApi, tab: BrowserTab, browser?: CaptureBrowser) {
  const url = tab.url ?? "";
  const bookmark = api.bookmarkFor(url);
  const saved = bookmark != null;
  const inCollectionIds = api.collectionIdsFor(url);
  const inPlaylistIds = api.playlistIdsFor(url);

  const toggleDefault = useCallback(() => {
    if (bookmark) void api.removeBookmark(bookmark.id);
    else void api.saveToCollection(captureBookmark(tab, browser), null);
  }, [api, bookmark, tab, browser]);

  const pickCollection = useCallback(
    (collectionId: string) => {
      if (bookmark) void api.toggleBookmarkCollection(bookmark.id, collectionId);
      else void api.saveToCollection(captureBookmark(tab, browser), collectionId);
    },
    [api, bookmark, tab, browser],
  );

  const createCollection = useCallback(
    async (name: string) => {
      const existing = findCollectionByName(api.vault.collections, name);
      const id = existing?.id ?? (await api.createCollection(name));
      if (!id) return;
      await api.saveToCollection(captureBookmark(tab, browser), id);
    },
    [api, tab, browser],
  );

  const pickPlaylist = useCallback(
    (playlistId: string) => {
      const itemId = api.mediaIdFor(url);
      if (itemId && api.playlistIdsFor(url).has(playlistId)) {
        void api.removeFromPlaylist(playlistId, itemId);
        return;
      }
      void api.addMediaToPlaylist(playlistId, captureMedia(tab, browser));
    },
    [api, url, tab, browser],
  );

  const createPlaylist = useCallback(
    async (name: string) => {
      const id = await api.createPlaylist(name);
      if (!id) return;
      await api.addMediaToPlaylist(id, captureMedia(tab, browser));
    },
    [api, tab, browser],
  );

  return useMemo(
    () => ({
      saved,
      inCollectionIds,
      inPlaylistIds,
      toggleDefault,
      pickCollection,
      createCollection,
      pickPlaylist,
      createPlaylist,
    }),
    [saved, inCollectionIds, inPlaylistIds, toggleDefault, pickCollection, createCollection, pickPlaylist, createPlaylist],
  );
}

export type SaveTargets = ReturnType<typeof useSaveTargets>;
