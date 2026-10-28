export { MediaDashboard } from "./MediaDashboard";

// ── Shared with other surfaces ──────────────────────────────────────────────
// God Mode renders the same browser stream in its own window. It consumes the
// dashboard's hooks and rules rather than re-implementing them, so a fix to how
// tabs are controlled or how a browser's status is judged lands on both.
export { useBrowsers } from "./hooks/useBrowsers";
export {
  useBrowserControls,
  type BrowserControls,
  type BrowserControlsOptions,
} from "./hooks/useBrowserControls";
export { useTabCloseConfirm } from "./hooks/useTabCloseConfirm";
export {
  browserDisplayLabel,
  formatAge,
  resolveBrowserStatus,
  type BrowserConnectionStatus,
} from "./lib/browserStatus";
export {
  collectActiveMediaTabs,
  faviconFromUrl,
  isTabPlaying,
  mediaArtist,
  mediaTimeLabel,
  tabHasMediaControls,
  tabIsLinkIdentifiedMedia,
  tabMatchesSearch,
  tabRowKey,
  tabSiteHost,
  type SearchTabMatch,
} from "./lib/browserMedia";
