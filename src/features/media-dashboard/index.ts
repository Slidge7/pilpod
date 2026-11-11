export { MediaDashboard } from "./MediaDashboard";

// ── Shared with other surfaces ──────────────────────────────────────────────
// Sky renders the same browser stream in its own window. It consumes the
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

// ── Preferences, shared with PilPod Sky's settings ─────────────────────────
// Each hook stores its value in localStorage and re-reads it when another
// window changes it, so a setting changed in Sky reaches the dashboard live.
export { useAppearance } from "./hooks/useAppearance";
export { useGlassAppearance } from "./hooks/useGlassAppearance";
export {
  useWallpaperSettings,
  type WallpaperSettings,
} from "./hooks/useWallpaperSettings";
export { prettyWallpaperName, wallpaperBaseName } from "./lib/wallpaperName";
export { useIdleConfig, IDLE_INTERVALS, type IdleController } from "./idle";
export {
  ALWAYS_ON_TOP_STORAGE_KEY,
  WALLPAPER_INTERVALS,
  type WallpaperIntervalId,
  type WallpaperSource,
} from "./constants";
