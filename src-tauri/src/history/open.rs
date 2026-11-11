//! Open a history entry (Windows only).
//!
//! DOCUMENTED SEAM: the one history file allowed to reach the browser
//! subsystem, and only through `browser_open` — the same focus-or-launch rule
//! the vault uses, with the vault's URL identity, so "open" behaves the same
//! wherever it is clicked.

use tauri::State;

use crate::browser_bridge::WsConnectionMap;
use crate::browser_tabs::{BrowserCommandsQueue, BrowserSlotsMap};
use crate::vault::url::normalize_url;

/// Focus a live tab already on this page, else open it in the default
/// browser. Returns `"focused"` | `"launched"`.
#[tauri::command]
pub fn history_open(
    slots: State<'_, BrowserSlotsMap>,
    commands: State<'_, BrowserCommandsQueue>,
    ws: State<'_, WsConnectionMap>,
    url: String,
) -> Result<String, String> {
    let url = url.trim();
    let target = normalize_url(url);
    crate::browser_open::focus_or_launch(&slots, &commands, &ws, url, |tab_url| {
        normalize_url(tab_url) == target
    })
    .map(|outcome| outcome.as_str().to_string())
}
