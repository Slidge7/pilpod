use tauri::State;

use crate::browser_focus_win;
use crate::browser_tabs::{enqueue_browser_command, BrowserCommandsQueue};

#[tauri::command]
pub fn browser_media_control(
    queue: State<'_, BrowserCommandsQueue>,
    browser_id: String,
    tab_id: i32,
    action: String,
    tab_title_for_focus: Option<String>,
    browser_window_hint: Option<String>,
) -> Result<(), String> {
    if browser_id.is_empty() {
        return Err("browserId is required".into());
    }
    let a = action.trim().to_ascii_lowercase();
    let normalized = match a.as_str() {
        "playpause" | "play_pause" | "toggle" => "playPause",
        "next" | "skipnext" => "next",
        "previous" | "prev" | "skipprevious" => "previous",
        "focustab" | "focus_tab" | "focus" => "focusTab",
        _ => return Err(format!("unknown action: {action}")),
    };
    enqueue_browser_command(&queue, &browser_id, tab_id, normalized);
    if normalized == "focusTab" {
        let title = tab_title_for_focus.unwrap_or_default();
        let hint = browser_window_hint.unwrap_or_default();
        browser_focus_win::spawn_raise_browser_window(title, hint);
    }
    Ok(())
}
