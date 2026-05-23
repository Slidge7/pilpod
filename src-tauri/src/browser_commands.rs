//! Tauri commands for the browser detection and tab control subsystem.

use std::time::{Duration, Instant};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};

use crate::browser_bridge::{
    connections::push_ws_sync_all, SyncRequestedFlag, WsConnectionMap,
};
use crate::browser_detector::{
    browser_name_to_id, emit_browsers_to_ui, merge_detected_and_slots,
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
) -> Vec<DetectedBrowser> {
    let detected_list = detected
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let slots_map = slots.lock().unwrap_or_else(|e| e.into_inner());
    let store = ext_store.lock().unwrap_or_else(|e| e.into_inner());
    let reconnecting_set = reconnecting.lock().unwrap_or_else(|e| e.into_inner());
    merge_detected_and_slots(&detected_list, &*slots_map, &*store, &*reconnecting_set)
}

#[tauri::command]
pub fn refresh_browser_connection(
    browser_id: String,
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    app: AppHandle,
) {
    if let Ok(mut map) = slots.lock() {
        for slot in map.values_mut() {
            if browser_name_to_id(&slot.browser_name) == browser_id {
                slot.last_seen = Instant::now() - Duration::from_secs(60);
            }
        }
    }
    emit_browsers_to_ui(&app, &detected, &slots, &ext_store, &reconnecting);
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
    emit_browsers_to_ui(&app, &detected, &slots, &ext_store, &reconnecting);
}
