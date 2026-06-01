//! Tauri commands for the browser detection and tab control subsystem.

use std::time::{Duration, Instant};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};

use crate::browser_bridge::{
    connections::push_ws_sync_all, SyncRequestedFlag, WsConnectionMap,
};
use crate::browser_detector::{
    build_browsers_payload, emit_browsers_to_ui,
    DetectedBrowsersState, ExtensionInstalledState, ReconnectingBrowsersState,
};
use crate::browser_dto::BrowsersUpdatePayload;
use crate::browser_tabs::BrowserSlotsMap;

#[tauri::command]
pub fn get_browsers(
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    ws_connections: State<'_, WsConnectionMap>,
) -> BrowsersUpdatePayload {
    build_browsers_payload(
        &detected,
        &slots,
        &ext_store,
        &reconnecting,
        &ws_connections,
    )
}

#[tauri::command]
pub fn refresh_browser_connection(
    browser_id: String,
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    ws_connections: State<'_, WsConnectionMap>,
    app: AppHandle,
) {
    if let Ok(mut map) = slots.lock() {
        if let Some(slot) = map.get_mut(&browser_id) {
            slot.last_seen = Instant::now() - Duration::from_secs(60);
        }
    }
    emit_browsers_to_ui(
        &app,
        &detected,
        &slots,
        &ext_store,
        &reconnecting,
        &ws_connections,
    );
}

#[tauri::command]
pub fn request_browser_sync(
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    sync_flag: State<'_, SyncRequestedFlag>,
    ws_connections: State<'_, WsConnectionMap>,
    app: AppHandle,
) {
    sync_flag.store(true, Ordering::Relaxed);
    push_ws_sync_all(&ws_connections);
    emit_browsers_to_ui(
        &app,
        &detected,
        &slots,
        &ext_store,
        &reconnecting,
        &ws_connections,
    );
}
