//! Phase 5 — smart open (Windows only).
//!
//! DOCUMENTED SEAM: this is the *one* vault file permitted to reach into the
//! browser subsystem, and it stays exactly one function deep. Everything else
//! in `vault/` obeys the isolation contract in `mod.rs`.
//!
//! Resolution:
//!   1. If a currently synced tab (in `BrowserSlotsMap`) normalizes to the same
//!      URL as the saved entry, enqueue the existing `focusTab` command path so
//!      the companion raises that tab. Zero protocol changes.
//!   2. Otherwise open the URL in the default browser; the tab then appears in
//!      the dashboard organically once the companion next syncs.

use tauri::State;

use super::state::VaultStateHandle;
use super::{emit_update, now_ms};

/// Open the default browser on `target` via `rundll32 url.dll` — robust against
/// URLs containing `&` (unlike `cmd /C start`) and needs no extra crates.
fn open_in_default_browser(target: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", target])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open_url: {e}"))
}

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
    if !(launch.starts_with("https://") || launch.starts_with("http://")) {
        return Err("url_scheme_not_allowed".into());
    }

    // Find a live tab whose URL normalizes to the saved entry.
    let focus = {
        let map = slots.lock().map_err(|_| "slots_poisoned".to_string())?;
        let mut found: Option<(String, i64)> = None;
        'outer: for slot in map.values() {
            for tab in &slot.tabs {
                if super::url::normalize_url(&tab.url) == target {
                    found = Some((slot.browser_id.clone(), tab.tab_id));
                    break 'outer;
                }
            }
        }
        found
    };

    let result = if let Some((browser_id, tab_id)) = focus {
        crate::browser_tabs::enqueue_browser_command(
            &commands,
            Some(&ws),
            &browser_id,
            tab_id as i32,
            "focusTab",
            None,
        );
        "focused"
    } else {
        open_in_default_browser(&launch)?;
        "launched"
    };

    vault.mark_opened(&target, now_ms());
    emit_update(&app, &vault);
    Ok(result.to_string())
}
