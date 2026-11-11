//! History Tauri commands. Thin by design: validate the payload, call one
//! service method, tell the UI when stored history changed.

use tauri::{AppHandle, State};

use super::model::{HistoryKind, HistoryPage, HistoryQuery, HistorySettings, MediaPlay, PageVisit};
use super::{notify_changed, now_ms, HistoryHandle, HistoryState};

/// The database could not be opened this session.
pub const ERR_UNAVAILABLE: &str = "history_unavailable";
/// `from_ms` was not before `to_ms`.
pub const ERR_INVALID_RANGE: &str = "invalid_range";

/// More ids than one selection can plausibly hold — a runaway caller.
const MAX_DELETE_IDS: usize = 1000;

fn service<'a>(state: &'a State<'_, HistoryState>) -> Result<&'a HistoryHandle, String> {
    state.0.as_ref().ok_or_else(|| ERR_UNAVAILABLE.to_string())
}

#[tauri::command]
pub fn history_get_settings(state: State<'_, HistoryState>) -> Result<HistorySettings, String> {
    Ok(service(&state)?.settings())
}

#[tauri::command]
pub fn history_set_settings(
    app: AppHandle,
    state: State<'_, HistoryState>,
    settings: HistorySettings,
) -> Result<HistorySettings, String> {
    let saved = service(&state)?.update_settings(settings, now_ms())?;
    notify_changed(&app);
    Ok(saved)
}

#[tauri::command]
pub fn history_query_pages(
    state: State<'_, HistoryState>,
    query: HistoryQuery,
) -> Result<HistoryPage<PageVisit>, String> {
    service(&state)?.query_pages(&query)
}

#[tauri::command]
pub fn history_query_media(
    state: State<'_, HistoryState>,
    query: HistoryQuery,
) -> Result<HistoryPage<MediaPlay>, String> {
    service(&state)?.query_media(&query)
}

#[tauri::command]
pub fn history_delete(
    app: AppHandle,
    state: State<'_, HistoryState>,
    kind: HistoryKind,
    ids: Vec<i64>,
) -> Result<usize, String> {
    let ids = &ids[..ids.len().min(MAX_DELETE_IDS)];
    let removed = service(&state)?.delete(kind, ids)?;
    notify_changed(&app);
    Ok(removed)
}

/// Clear rows that started in `[from_ms, to_ms)`; an omitted bound is open.
/// `kind: None` clears pages and media together.
#[tauri::command]
pub fn history_clear(
    app: AppHandle,
    state: State<'_, HistoryState>,
    kind: Option<HistoryKind>,
    from_ms: Option<i64>,
    to_ms: Option<i64>,
) -> Result<usize, String> {
    if let (Some(from), Some(to)) = (from_ms, to_ms) {
        if from >= to {
            return Err(ERR_INVALID_RANGE.into());
        }
    }
    let removed = service(&state)?.clear(kind, from_ms, to_ms)?;
    notify_changed(&app);
    Ok(removed)
}
