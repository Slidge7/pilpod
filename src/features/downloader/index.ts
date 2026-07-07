export { DownloadPanel } from "./DownloadPanel";
export { useDownloader } from "./hooks/useDownloader";
export type { DownloaderApi } from "./hooks/useDownloader";
export * from "./types";

/** Compile-time feature flag: set VITE_FEATURE_DOWNLOADER=false to hide the
 * downloader UI entirely (independent of runtime premium gating). */
export const DOWNLOADER_UI_ENABLED =
  (import.meta.env.VITE_FEATURE_DOWNLOADER ?? "true") !== "false";
