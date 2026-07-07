import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  VAULT_EVENTS,
  type AddBookmarkArgs,
  type AddMediaArgs,
  type BookmarkPatchArgs,
  type OpenEntryResult,
  type VaultData,
} from "../types";
import { normalizeUrl } from "../lib/normalizeUrl";

const EMPTY_VAULT: VaultData = {
  version: 1,
  bookmarks: [],
  mediaItems: [],
  playlists: [],
};

export type AddResult = { id: string } | { error: string };

/**
 * The single stateful vault hook (pattern: `useDownloader`). Listens to
 * `vault://update`, hydrates from Rust via `vault_get_state`, and exposes an
 * O(1) `savedUrlSet` for "is this tab already saved?" lookups plus every
 * mutation callback. Rust is the source of truth; we hydrate then trust events.
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

  /** Normalized URLs of every saved bookmark — O(1) membership tests. */
  const savedUrlSet = useMemo(
    () => new Set(vault.bookmarks.map((b) => b.normalizedUrl)),
    [vault.bookmarks],
  );

  const isSaved = useCallback(
    (url: string) => savedUrlSet.has(normalizeUrl(url)),
    [savedUrlSet],
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

  /** Save-or-remove a tab's bookmark by URL. Returns the resulting saved state. */
  const toggleBookmark = useCallback(
    async (args: AddBookmarkArgs): Promise<boolean> => {
      const normalized = normalizeUrl(args.url);
      const existing = vault.bookmarks.find((b) => b.normalizedUrl === normalized);
      if (existing) {
        await removeBookmark(existing.id);
        return false;
      }
      const res = await addBookmark(args);
      return "id" in res;
    },
    [vault.bookmarks, addBookmark, removeBookmark],
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
    addBookmark,
    updateBookmark,
    removeBookmark,
    toggleBookmark,
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
