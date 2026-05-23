// TypeScript mirrors of the Rust downloader structs.

export type DownloadStatus =
  | { type: "Queued" }
  | { type: "FetchingInfo" }
  | { type: "Downloading" }
  | { type: "Muxing" }
  | { type: "Done" }
  | { type: "Cancelled" }
  | { type: "Error"; data: string };

export type DownloadTask = {
  id: string;
  url: string;
  title: string | null;
  thumbnail: string | null;
  status: DownloadStatus;
  percent: number;
  speed: string | null;
  eta: string | null;
  output_path: string | null;
  format_id: string | null;
  audio_only: boolean;
  audio_format: string | null;
  created_at: number;
};

export type FormatPreset = {
  label: string;
  format_id: string;
  audio_only: boolean;
  audio_format: string | null;
};

export type VideoInfoWithPresets = {
  title: string;
  thumbnail: string | null;
  duration: number | null;
  webpage_url: string;
  presets: FormatPreset[];
};

export type BinaryStatus = {
  ytdlp_present: boolean;
  ffmpeg_present: boolean;
  ytdlp_version: string | null;
  ffmpeg_version: string | null;
  ok: boolean;
};

export type ProgressPayload = {
  id: string;
  percent: number;
  speed: string | null;
  eta: string | null;
};

export type CompletePayload = {
  id: string;
  output_path: string | null;
};

export type ErrorPayload = {
  id: string;
  message: string;
};
