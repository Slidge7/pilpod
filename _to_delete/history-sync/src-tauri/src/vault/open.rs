//! Phase 5 — smart open (Windows only).
//!
//! DOCUMENTED SEAM: this is the *one* vault file permitted to reach into the
//! browser subsystem, and it stays exactly one call deep — the shared
//! `browser_open` helper. Everything else in `vault/` obeys the isolation
//! contract in `mod.rs`.
//!
//! Resolution (implemented by `browser_open::focus_or_launch`):
//!   1. If a currently synced tab normalizes to the same URL as the saved
//!      entry, raise that tab through the existing `focusTab` command path.
//!   2. Otherwise open the URL in the default browser; the tab then appears in
//!      the dashboard organically once the companion next syncs.

use tauri::State;

use super::state::VaultStateHandle;
use super::{emit_update, now_ms};

/// Focus a live tab matching `normalized_url`, else launch the default browser.
/// Updates open/play counters and returns `"focused"` | `"launched"`.
#[tauri::command]
pub fn vault_open_entry(
    app: tauri::AppHandle,
    vault: State<'_, VaultStateHandle>,
    slots: State<'_, crate::browser_tabs::BrowserSlotsMap>,
    commands: State<'_, crate::browser_tabs::BrowserCommandsQueue>,
    ws: State<'_, crate::browser_bridge::WsConnectionMap>,
    url: String,
    normalized_url: String,
) -> Result<String, String> {
    let target = normalized_url.trim().to_string();
    let launch = url.trim().to_string();

    let outcome = crate::browser_open::focus_or_launch(&slots, &commands, &ws, &launch, |tab_url| {
        super::url::normalize_url(tab_url) == target
    })?;

    vault.mark_opened(&target, now_ms());
    emit_update(&app, &vault);
    Ok(outcome.as_str().to_string())
}
