/** TypeScript mirrors of the Rust downloader structs (serde camelCase). */

export type DownloadStatusKind =
  | "queued"
  | "downloading"
  | "muxing"
  | "done"
  | "cancelled"
  | "error";

export interface DownloadStatus {
  kind: DownloadStatusKind;
  /** Present when kind === "error". */
  message?: string;
}

export interface DownloadTask {
  id: string;
  url: string;
  title: string | null;
  thumbnail: string | null;
  presetId: string;
  status: DownloadStatus;
  percent: number;
  speed: string | null;
  eta: string | null;
  outputDir: string;
  filename: string | null;
  outputPath: string | null;
  createdAt: number;
}

export interface MediaFormat {
  formatId: string;
  ext: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  filesize: number | null;
  filesizeApprox: number | null;
  tbr: number | null;
  formatNote: string | null;
}

export interface VideoInfo {
  title: string;
  thumbnail: string | null;
  duration: number | null;
  webpageUrl: string | null;
  uploader: string | null;
  formats: MediaFormat[];
}

export interface Preset {
  id: string;
  label: string;
  kind: "video" | "audio";
  formatSelector: string;
  audioFormat: string | null;
  container: string | null;
  filesizeHint: number | null;
}

export interface FetchInfoResponse {
  info: VideoInfo;
  presets: Preset[];
}

export interface BinaryStatus {
  ok: boolean;
  ytdlpPath: string | null;
  ytdlpVersion: string | null;
  ffmpegPath: string | null;
  ffmpegVersion: string | null;
  managed: boolean;
}

export interface DownloadSettings {
  outputDir: string;
  preferredPreset: string;
  concurrentLimit: number;
  autoOpenOnComplete: boolean;
}

export const DL_EVENTS = {
  update: "dl://update",
  progress: "dl://progress",
  complete: "dl://complete",
  error: "dl://error",
  binaryStatus: "dl://binary-status",
} as const;

export interface ProgressEvent {
  id: string;
  percent: number;
  speed: string | null;
  eta: string | null;
}
