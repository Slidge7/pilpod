//! Bring a URL to the user (Windows only).
//!
//! If a synced tab is already showing the page, enqueue the existing
//! `focusTab` command so the companion raises it — zero protocol changes.
//! Otherwise open the URL in the default browser; the new tab then appears in
//! the dashboard on the companion's next sync.
//!
//! Shared by every "open this entry" action (vault, history) so they agree on
//! what "already open" means and on how a URL is launched. Callers decide page
//! identity through `is_same_page`; this module stays free of URL rules.

use crate::browser_bridge::WsConnectionMap;
use crate::browser_tabs::{enqueue_browser_command, BrowserCommandsQueue, BrowserSlotsMap};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenOutcome {
    /// An existing tab was raised.
    Focused,
    /// The default browser was asked to open the URL.
    Launched,
}

impl OpenOutcome {
    /// The wire value the frontend switches on.
    pub fn as_str(self) -> &'static str {
        match self {
            OpenOutcome::Focused => "focused",
            OpenOutcome::Launched => "launched",
        }
    }
}

/// Focus the first live tab for which `is_same_page(tab_url)` holds, else
/// launch `url`. Only `http(s)` URLs are ever launched.
pub fn focus_or_launch(
    slots: &BrowserSlotsMap,
    commands: &BrowserCommandsQueue,
    ws: &WsConnectionMap,
    url: &str,
    is_same_page: impl Fn(&str) -> bool,
) -> Result<OpenOutcome, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("url_scheme_not_allowed".into());
    }

    let live_tab = {
        let map = slots.lock().map_err(|_| "slots_poisoned".to_string())?;
        map.values().find_map(|slot| {
            slot.tabs
                .iter()
                .find(|tab| is_same_page(tab.url.as_str()))
                .map(|tab| (slot.browser_id.clone(), tab.tab_id))
        })
    };

    if let Some((browser_id, tab_id)) = live_tab {
        enqueue_browser_command(
            commands,
            Some(ws),
            &browser_id,
            tab_id as i32,
            "focusTab",
            None,
        );
        return Ok(OpenOutcome::Focused);
    }

    open_in_default_browser(url)?;
    Ok(OpenOutcome::Launched)
}

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
