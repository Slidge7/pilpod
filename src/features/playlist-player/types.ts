/**
 * TypeScript mirror of the Rust playlist-player DTO (serde camelCase, see
 * `src-tauri/src/playlist_player/dto.rs`). Rust is the source of truth; keep
 * in sync when the Rust structs change.
 */

export type RepeatMode = "off" | "one" | "all";

export type PlayerStatus = "idle" | "opening" | "ready" | "ended" | "error";

export interface PlayerStateDto {
  active: boolean;
  playlistId?: string;
  browserId?: string;
  tabId?: number;
  windowId?: number;
  status: PlayerStatus;
  error?: string | null;
  currentItemId?: string | null;
  /** 1-based position in the play order (0 when inactive). */
  trackNumber: number;
  totalTracks: number;
  repeat: RepeatMode;
  shuffle: boolean;
  autoPlay: boolean;
}

export const PLAYER_EVENTS = {
  update: "player://update",
} as const;

export const IDLE_PLAYER_STATE: PlayerStateDto = {
  active: false,
  status: "idle",
  trackNumber: 0,
  totalTracks: 0,
  repeat: "off",
  shuffle: false,
  autoPlay: true,
};

/** Typed backend error codes → user-facing messages. */
export function playerErrorMessage(code: string): string {
  switch (code) {
    case "companion_nav_unsupported":
      return "Update the PilPod companion extension in this browser to play playlists.";
    case "browser_not_connected":
      return "This browser is not connected. Open it and check the extension.";
    case "browser_disconnected":
      return "Lost the browser connection — playback paused.";
    case "playlist_empty":
      return "This playlist has no playable items.";
    case "playlist_not_found":
      return "Playlist not found.";
    case "open_timeout":
      return "The browser did not open the player tab in time.";
    case "open_failed":
      return "The browser could not open the player tab.";
    default:
      return code;
  }
}

/** Cycle order for the repeat toggle button. */
export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off";
}
