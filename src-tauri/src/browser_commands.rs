//! Tauri commands for the browser detection and tab control subsystem.

use std::time::{Duration, Instant};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};

use crate::browser_bridge::{
    connections::{push_ws_sync_all, ws_connected_ids}, SyncRequestedFlag, WsConnectionMap,
};
use crate::browser_detector::{
    emit_browsers_to_ui, merge_detected_and_slots,
    DetectedBrowsersState, ExtensionInstalledState, ReconnectingBrowsersState,
};
use crate::browser_tabs::BrowserSlotsMap;
use crate::gsmtc::dto::DetectedBrowser;

#[tauri::command]
pub fn get_browsers(
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    ws_connections: State<'_, WsConnectionMap>,
) -> Vec<DetectedBrowser> {
    let detected_list = detected
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let slots_map = slots.lock().unwrap_or_else(|e| e.into_inner());
    let store = ext_store.lock().unwrap_or_else(|e| e.into_inner());
    let reconnecting_set = reconnecting.lock().unwrap_or_else(|e| e.into_inner());
    let ws_connected = ws_connected_ids(&ws_connections);
    merge_detected_and_slots(
        &detected_list,
        &*slots_map,
        &*store,
        &*reconnecting_set,
        &ws_connected,
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
