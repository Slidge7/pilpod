/**
 * Webview label of the God Mode window. `App.tsx` routes on it; it must match
 * `GOD_MODE_LABEL` in `src-tauri/src/god_mode.rs` and the `god-mode`
 * capability.
 */
export const GOD_MODE_LABEL = "god-mode";

/** Opens the window, or focuses it if it is already open. */
export const OPEN_GOD_MODE_COMMAND = "open_god_mode_window";
