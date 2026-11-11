import { invoke } from "@tauri-apps/api/core";
import type { BlockedVideo, ClearScope, YoutubeBlockState } from "./types";

/** The YouTube-blocker command surface, typed once. */
export const youtubeBlockApi = {
  getState: () => invoke<YoutubeBlockState>("youtube_block_get_state"),

  /**
   * Block the video at `url` (any YouTube video link). Rejects with
   * `not_a_youtube_video` for anything else.
   */
  add: (args: { url: string; title?: string | null; browserName?: string | null }) =>
    invoke<BlockedVideo>("youtube_block_add", {
      url: args.url,
      title: args.title ?? null,
      browserName: args.browserName ?? null,
    }),

  remove: (videoId: string) => invoke<boolean>("youtube_block_remove", { videoId }),

  clearHistory: (scope: ClearScope) => invoke<void>("youtube_block_clear_history", { scope }),
};
