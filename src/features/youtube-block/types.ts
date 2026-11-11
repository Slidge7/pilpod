/**
 * Mirrors `src-tauri/src/youtube_block/mod.rs` (serde camelCase). Rust is the
 * source of truth; keep this in sync when those DTOs change.
 */

export type BlockedVideo = {
  videoId: string;
  title: string;
  url: string;
  blockedAtMs: number;
};

/** `blocked`/`unblocked`: the user's own actions. `skipped`: done automatically. */
export type BlockEventKind = "blocked" | "unblocked" | "skipped";

export type BlockEvent = {
  id: number;
  kind: BlockEventKind;
  videoId: string;
  title: string;
  url: string;
  atMs: number;
  browserName?: string;
  /** Only on `skipped`: moved to the next video, or closed the tab. */
  action?: "next" | "close";
};

export type YoutubeBlockState = {
  /** Newest block first. */
  blocked: BlockedVideo[];
  /** Newest event first. */
  history: BlockEvent[];
};

export type ClearScope = "mine" | "skipped" | "all";

export const EVT_YOUTUBE_BLOCK_CHANGED = "youtube-block://changed";
export const ERR_NOT_A_VIDEO = "not_a_youtube_video";
