import { createPortal } from "react-dom";
import type { BrowserTab } from "../../../types/media";
import type { VaultApi } from "../hooks/useVault";
import { useAnchoredMenu } from "../hooks/useAnchoredMenu";
import type { CaptureBrowser } from "../lib/capture";
import { useSaveTargets } from "../hooks/useSaveTargets";
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
 * The writes and their rules live in `useSaveTargets` (shared with PilPod
 * Sky's save menu), so `SaveTargetMenu` stays presentational and
 * `MediaDashboard` stays a wiring layer. All state is read through
 * `VaultApi`'s O(1) index callbacks — nothing here scans the vault, which
 * matters because one of these renders per visible tab row.
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
  const { anchorRef, menuRef, open, toggle, close, pos } = useAnchoredMenu({
    width: SAVE_MENU_WIDTH,
    height: SAVE_MENU_MAX_HEIGHT,
  });

  const targets = useSaveTargets(api, tab, browser);
  const { saved } = targets;

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
                inPlaylistIds={targets.inPlaylistIds}
                inCollectionIds={targets.inCollectionIds}
                saved={saved}
                onPickPlaylist={targets.pickPlaylist}
                onCreatePlaylist={(name) => void targets.createPlaylist(name)}
                onPickCollection={targets.pickCollection}
                onCreateCollection={(name) => void targets.createCollection(name)}
                onToggleDefault={targets.toggleDefault}
                onClose={close}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
