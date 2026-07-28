/**
 * TypeScript mirror of `src-tauri/src/inapp_player/dto.rs` (serde camelCase).
 * Rust is the source of truth; keep in sync.
 */

export interface InAppMedia {
  active: boolean;
  /** Page is loading and no media element exists yet → show the spinner. */
  loading: boolean;
  url: string;
  title: string;
  artist: string;
  artworkUrl: string;
  playbackState: "playing" | "paused" | "none" | string;
  duration: number;
  currentTime: number;
  /** Percentage, 100 = native. */
  volume: number;
  muted: boolean;
  canSeek: boolean;
}

export const INAPP_MEDIA_EVENT = "inapp://media";

export const IDLE_MEDIA: InAppMedia = {
  active: false,
  loading: false,
  url: "",
  title: "",
  artist: "",
  artworkUrl: "",
  playbackState: "none",
  duration: 0,
  currentTime: 0,
  volume: 100,
  muted: false,
  canSeek: false,
};

/** Webview label of the playlist UI surface (mirrors `window::UI_LABEL`). */
export const PLAYER_UI_LABEL = "player-ui";
/** Webview label of the video stage (mirrors `window::STAGE_LABEL`). */
export const PLAYER_STAGE_LABEL = "player-stage";
