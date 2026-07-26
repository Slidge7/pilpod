import { useCallback } from "react";
import { createPortal } from "react-dom";
import type { BrowserTab } from "../../../types/media";
import type { VaultApi } from "../hooks/useVault";
import { useAnchoredMenu } from "../hooks/useAnchoredMenu";
import { captureBookmark, captureMedia, type CaptureBrowser } from "../lib/capture";
import { findCollectionByName } from "../lib/vaultIndex";
import {
  SaveTargetMenu,
  SAVE_MENU_MAX_HEIGHT,
  SAVE_MENU_WIDTH,
} from "./SaveTargetMenu";
import { IconBookmark, IconBookmarkFilled } from "../../../shared/ui/icons";

/**
 * The bookmark button on a tab row: a save-state toggle *and* the trigger for
 * the "where should this go?" menu.
 *
 * This component owns every write the menu can trigger, so `SaveTargetMenu`
 * stays presentational and `MediaDashboard` stays a wiring layer. All state is
 * read through `VaultApi`'s O(1) index callbacks — nothing here scans the vault,
 * which matters because one of these renders per visible tab row.
 *
 * Interaction rules:
 *   * A row is a checkbox, so the menu stays open after a pick (filing one tab
 *     into two places is a single interaction).
 *   * "All bookmarks" saves when unsaved and removes the bookmark when saved —
 *     that is the only destructive row, and it is the one users already expect
 *     the bookmark icon to control.
 *   * Toggling a collection off never unsaves the bookmark; it just unfiles it.
 */
export function SaveTabMenuButton({
  api,
  tab,
  browser,
  isMediaTab,
  busy,
}: {
  api: VaultApi;
  tab: BrowserTab;
  /** Provenance recorded on whatever gets created. */
  browser?: CaptureBrowser;
  /** Media tabs additionally get the playlists section. */
  isMediaTab: boolean;
  busy?: boolean;
}) {
  const url = tab.url ?? "";
  const { anchorRef, menuRef, open, toggle, close, pos } = useAnchoredMenu({
    width: SAVE_MENU_WIDTH,
    height: SAVE_MENU_MAX_HEIGHT,
  });

  const bookmark = api.bookmarkFor(url);
  const saved = bookmark != null;

  // ── Bookmarks ────────────────────────────────────────────────────────
  const toggleDefault = useCallback(() => {
    if (bookmark) void api.removeBookmark(bookmark.id);
    else void api.saveToCollection(captureBookmark(tab, browser), null);
  }, [api, bookmark, tab, browser]);

  const pickCollection = useCallback(
    (collectionId: string) => {
      // Unsaved ⇒ one call creates the bookmark already filed. Saved ⇒ toggle.
      if (bookmark) void api.toggleBookmarkCollection(bookmark.id, collectionId);
      else void api.saveToCollection(captureBookmark(tab, browser), collectionId);
    },
    [api, bookmark, tab, browser],
  );

  const createCollection = useCallback(
    async (name: string) => {
      // The backend rejects duplicate names; reuse rather than show an error.
      const existing = findCollectionByName(api.vault.collections, name);
      const id = existing?.id ?? (await api.createCollection(name));
      if (!id) return;
      await api.saveToCollection(captureBookmark(tab, browser), id);
    },
    [api, tab, browser],
  );

  // ── Playlists (media tabs only) ──────────────────────────────────────
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

  const label = saved ? "Saved — choose where to file this tab" : "Save this tab";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={[
          "pilpod-vault-save-btn",
          saved ? "pilpod-vault-save-btn--saved" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={busy}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        {saved ? (
          <IconBookmarkFilled className="pilpod-icon--sm" />
        ) : (
          <IconBookmark className="pilpod-icon--sm" />
        )}
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="pilpod-vault-menu-layer"
              style={{ top: pos.top, left: pos.left, width: SAVE_MENU_WIDTH }}
              onClick={(e) => e.stopPropagation()}
            >
              <SaveTargetMenu
                showPlaylists={isMediaTab}
                playlists={api.vault.playlists}
                collections={api.vault.collections}
                inPlaylistIds={api.playlistIdsFor(url)}
                inCollectionIds={api.collectionIdsFor(url)}
                saved={saved}
                onPickPlaylist={pickPlaylist}
                onCreatePlaylist={(name) => void createPlaylist(name)}
                onPickCollection={pickCollection}
                onCreateCollection={(name) => void createCollection(name)}
                onToggleDefault={toggleDefault}
                onClose={close}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
