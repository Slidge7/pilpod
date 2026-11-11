export { VaultPanel } from "./VaultPanel";
export { useVault } from "./hooks/useVault";
export type { VaultApi } from "./hooks/useVault";
export * from "./types";
export { VAULT_UI_ENABLED, VAULT_OPEN_ENABLED } from "./constants";

// ── Shared with other surfaces ──────────────────────────────────────────────
// Sky renders its own Bookmarks and Playlists sections over the same rules.
export {
  UNFILED,
  collectTags,
  countByCollection,
  filterBookmarksByCollection,
  filterBookmarksByTags,
  orderBookmarks,
  type CollectionFilter,
} from "./lib/vaultSearch";
export { exportVault, importVault } from "./lib/backup";
export { useSaveTargets, type SaveTargets } from "./hooks/useSaveTargets";
export { useAnchoredMenu } from "./hooks/useAnchoredMenu";
export { captureBookmark, captureMedia, type CaptureBrowser } from "./lib/capture";
export { findCollectionByName } from "./lib/vaultIndex";
