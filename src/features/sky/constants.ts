/**
 * Webview label of the Sky window. `App.tsx` routes on it; it must match
 * `SKY_LABEL` in `src-tauri/src/sky.rs` and the `sky`
 * capability.
 */
export const SKY_LABEL = "sky";

/** Opens the window, or focuses it if it is already open. */
export const OPEN_SKY_COMMAND = "open_sky_window";
