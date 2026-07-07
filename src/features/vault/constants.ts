/**
 * Compile-time feature flags for the vault, mirroring DOWNLOADER_UI_ENABLED.
 * Set VITE_FEATURE_VAULT=false to hide the vault UI entirely.
 */
export const VAULT_UI_ENABLED =
  (import.meta.env.VITE_FEATURE_VAULT ?? "true") !== "false";

/**
 * Whether the smart-open command is wired at the UI layer. The backend command
 * (`vault_open_entry`, Phase 5) is Windows-only and degrades gracefully to a
 * default-browser launch, so this simply follows the UI flag.
 */
export const VAULT_OPEN_ENABLED = VAULT_UI_ENABLED;
