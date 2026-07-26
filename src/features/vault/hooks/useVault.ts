import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  VAULT_EVENTS,
  type AddBookmarkArgs,
  type AddMediaArgs,
  type Bookmark,
  type BookmarkPatchArgs,
  type OpenEntryResult,
  type VaultData,
} from "../types";
import { normalizeUrl } from "../lib/normalizeUrl";
import {
  EMPTY_ID_SET,
  indexBookmarksByUrl,
  indexMediaIdsByUrl,
  indexPlaylistIdsByUrl,
} from "../lib/vaultIndex";

const EMPTY_VAULT: VaultData = {
  version: 1,
  bookmarks: [],
  mediaItems: [],
  playlists: [],
  collections: [],
};

export type AddResult = { id: string } | { error: string };

/**
 * The single stateful vault hook (pattern: `useDownloader`). Listens to
 * `vault://update`, hydrates from Rust via `vault_get_state`, and exposes O(1)
 * lookups ("is this tab saved? in which collections? in which playlists?")
 * plus every mutation callback. Rust is the source of truth; we hydrate then
 * trust events.
 *
 * Every lookup is backed by a memoized index rather than a scan, because the
 * browser page calls them once per visible tab row on every render.
 */
export function useVault() {
  const [vault, setVault] = useState<VaultData>(EMPTY_VAULT);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const unlisteners: Promise<UnlistenFn>[] = [
      listen<VaultData>(VAULT_EVENTS.update, (e) => {
        if (alive.current && e.payload) setVault(e.payload);
      }),
    ];

    invoke<VaultData>("vault_get_state")
      .then((data) => {
        if (alive.current && data) setVault(data);
      })
      .catch(() => {});

    return () => {
      alive.current = false;
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  // ── Derived indexes (one O(vault) pass per update, O(1) reads) ────────
  // The browser page renders a save menu per tab row; every lookup below must
  // be constant-time or the menu cost scales with tabs × vault size.

  /** `normalizedUrl` → bookmark, for saved-state and collection membership. */
  const bookmarkByUrl = useMemo(
    () => indexBookmarksByUrl(vault.bookmarks),
    [vault.bookmarks],
  );

  /** `normalizedUrl` → ids of playlists already containing it. */
  const playlistIdsByUrl = useMemo(
    () => indexPlaylistIdsByUrl(vault.mediaItems, vault.playlists),
    [vault.mediaItems, vault.playlists],
  );

  /** Normalized URLs of every saved bookmark — O(1) membership tests. */
  const savedUrlSet = useMemo(
    () => new Set(bookmarkByUrl.keys()),
    [bookmarkByUrl],
  );

  const isSaved = useCallback(
    (url: string) => bookmarkByUrl.has(normalizeUrl(url)),
    [bookmarkByUrl],
  );

  /** The saved bookmark for a live tab URL, or null. */
  const bookmarkFor = useCallback(
    (url: string): Bookmark | null => bookmarkByUrl.get(normalizeUrl(url)) ?? null,
    [bookmarkByUrl],
  );

  /** Collections the URL is filed under (empty = default/unfiled or unsaved). */
  const collectionIdsFor = useCallback(
    (url: string): ReadonlySet<string> => {
      const ids = bookmarkByUrl.get(normalizeUrl(url))?.collectionIds;
      return ids && ids.length > 0 ? new Set(ids) : EMPTY_ID_SET;
    },
    [bookmarkByUrl],
  );

  /** `normalizedUrl` → pooled media-item id (needed to remove from a playlist). */
  const mediaIdByUrl = useMemo(
    () => indexMediaIdsByUrl(vault.mediaItems),
    [vault.mediaItems],
  );

  const mediaIdFor = useCallback(
    (url: string): string | null => mediaIdByUrl.get(normalizeUrl(url)) ?? null,
    [mediaIdByUrl],
  );

  /** Playlists already containing the URL. */
  const playlistIdsFor = useCallback(
    (url: string): ReadonlySet<string> =>
      playlistIdsByUrl.get(normalizeUrl(url)) ?? EMPTY_ID_SET,
    [playlistIdsByUrl],
  );

  // ── Bookmark mutations ────────────────────────────────────────────────
  const addBookmark = useCallback(async (args: AddBookmarkArgs): Promise<AddResult> => {
    try {
      const id = await invoke<string>("vault_add_bookmark", { args });
      return { id };
    } catch (err) {
      return { error: String(err) };
    }
  }, []);

  const updateBookmark = useCallback(async (args: BookmarkPatchArgs): Promise<boolean> => {
    try {
      await invoke("vault_update_bookmark", { args });
      return true;
    } catch {
      return false;
    }
  }, []);

  const removeBookmark = useCallback(async (id: string): Promise<boolean> => {
    try {
      await invoke("vault_remove_bookmark", { id });
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Bookmark collections ──────────────────────────────────────────────

  /**
   * Save-or-attach in one IPC call. `collectionId` null ⇒ the default (unfiled)
   * view: the bookmark is created if missing and left alone otherwise. Safe to
   * call repeatedly — the backend is idempotent and never duplicates a URL.
   */
  const saveToCollection = useCallback(
    async (args: AddBookmarkArgs, collectionId: string | null): Promise<AddResult> => {
      try {
        const id = await invoke<string>("vault_save_bookmark_to_collection", {
          args,
          collectionId,
        });
        return { id };
      } catch (err) {
        return { error: String(err) };
      }
    },
    [],
  );

  const createCollection = useCallback(
    async (name: string, emoji?: string | null): Promise<string | null> => {
      try {
        return await invoke<string>("vault_create_collection", {
          args: { name, emoji: emoji ?? null },
        });
      } catch {
        return null;
      }
    },
    [],
  );

  const updateCollection = useCallback(
    async (id: string, patch: { name?: string; emoji?: string }): Promise<boolean> => {
      try {
        await invoke("vault_update_collection", { args: { id, ...patch } });
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  /** Deletes the collection only — its bookmarks fall back to the default view. */
  const deleteCollection = useCallback(async (id: string): Promise<boolean> => {
    try {
      await invoke("vault_delete_collection", { id });
      return true;
    } catch {
      return false;
    }
  }, []);

  /** Toggle one bookmark's membership. Returns the new state, or null on error. */
  const toggleBookmarkCollection = useCallback(
    async (bookmarkId: string, collectionId: string): Promise<boolean | null> => {
      try {
        return await invoke<boolean>("vault_toggle_bookmark_collection", {
          bookmarkId,
          collectionId,
        });
      } catch {
        return null;
      }
    },
    [],
  );

  // ── Playlist mutations (Phase 3 backend) ──────────────────────────────
  const createPlaylist = useCallback(
    async (name: string, emoji?: string | null): Promise<string | null> => {
      try {
        return await invoke<string>("vault_create_playlist", { args: { name, emoji: emoji ?? null } });
      } catch {
        return null;
      }
    },
    [],
  );

  const updatePlaylist = useCallback(
    async (id: string, patch: { name?: string; emoji?: string }): Promise<boolean> => {
      try {
        await invoke("vault_update_playlist", { args: { id, ...patch } });
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const deletePlaylist = useCallback(async (id: string): Promise<boolean> => {
    try {
      await invoke("vault_delete_playlist", { id });
      return true;
    } catch {
      return false;
    }
  }, []);

  const addMediaToPlaylist = useCallback(
    async (playlistId: string, media: AddMediaArgs): Promise<string | null> => {
      try {
        return await invoke<string>("vault_add_media_to_playlist", { playlistId, media });
      } catch {
        return null;
      }
    },
    [],
  );

  const removeFromPlaylist = useCallback(
    async (playlistId: string, itemId: string): Promise<boolean> => {
      try {
        await invoke("vault_remove_from_playlist", { playlistId, itemId });
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const reorderPlaylist = useCallback(
    async (playlistId: string, itemIds: string[]): Promise<boolean> => {
      try {
        await invoke("vault_reorder_playlist", { playlistId, itemIds });
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  // ── Smart open (Phase 5) ──────────────────────────────────────────────
  const openEntry = useCallback(
    async (url: string, normalizedUrl: string): Promise<OpenEntryResult | null> => {
      try {
        return await invoke<OpenEntryResult>("vault_open_entry", { url, normalizedUrl });
      } catch {
        return null;
      }
    },
    [],
  );

  return {
    vault,
    savedUrlSet,
    isSaved,
    bookmarkFor,
    collectionIdsFor,
    playlistIdsFor,
    mediaIdFor,
    saveToCollection,
    createCollection,
    updateCollection,
    deleteCollection,
    toggleBookmarkCollection,
    addBookmark,
    updateBookmark,
    removeBookmark,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    addMediaToPlaylist,
    removeFromPlaylist,
    reorderPlaylist,
    openEntry,
  };
}

export type VaultApi = ReturnType<typeof useVault>;
