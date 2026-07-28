/**
 * TypeScript mirror of the Rust playlist-player DTO (serde camelCase, see
 * `src-tauri/src/playlist_player/dto.rs`). Rust is the source of truth; keep
 * in sync when the Rust structs change.
 */

export type RepeatMode = "off" | "one" | "all";

export type PlayerStatus = "idle" | "opening" | "ready" | "ended" | "error";

/**
 * Where a playlist plays: a tab in a connected browser, or PilPod's own
 * webview window (no extension involved).
 */
export type PlaybackTarget = "browser" | "inApp";

/** Synthetic browser id of the in-app player (mirrors `inapp_player::state`). */
export const INAPP_BROWSER_ID = "pilpod-inapp";

export interface PlayerStateDto {
  active: boolean;
  playlistId?: string;
  target: PlaybackTarget;
  /** `pilpod-inapp` for in-app sessions — the tab lookup is identical. */
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
  target: "browser",
  trackNumber: 0,
  totalTracks: 0,
  repeat: "off",
  shuffle: false,
  autoPlay: true,
};

/** Typed backend error codes → user-facing messages. */
export function playerErrorMessage(code: string): string {
  // Window-creation failures carry the OS/webview reason after the colon —
  // keep it visible, it is the only clue when the surface never appears.
  if (code.startsWith("player_window_failed")) {
    const reason = code.slice("player_window_failed:".length).trim();
    return reason
      ? `Could not open the player window — ${reason}`
      : "Could not open the player window.";
  }
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
    case "no_browser_picked":
      return "Pick where to play this playlist.";
    case "in-app player is not running":
      return "The in-app player window is closed.";
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
