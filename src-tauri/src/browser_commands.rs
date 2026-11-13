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
    app: AppHandle,
) -> BrowsersUpdatePayload {
    build_browsers_payload(
        &detected,
        &slots,
        &ext_store,
        &reconnecting,
        &ws_connections,
        &crate::extension_setup::snapshot_from_app(&app),
    )
}

/// Open a browser in one of its profiles (`--profile-directory`). With
/// `add_companion`, the window opens on the companion's store listing so the
/// user can add it to that profile. Only profiles PilPod itself listed are
/// accepted, so nothing from the frontend reaches the command line unchecked.
#[tauri::command]
pub fn open_browser_profile(
    os_browser_id: String,
    profile_dir: String,
    add_companion: Option<bool>,
) -> Result<(), String> {
    let known = crate::browser_profiles::snapshot()
        .get(&os_browser_id)
        .is_some_and(|list| list.iter().any(|p| p.can_launch && p.dir == profile_dir));
    if !known {
        return Err(format!("unknown profile {profile_dir:?} for {os_browser_id}"));
    }
    let exe = crate::browser_catalog::resolve_exe_path(&os_browser_id)
        .ok_or_else(|| format!("{os_browser_id} is not installed"))?;

    let mut cmd = std::process::Command::new(&exe);
    cmd.arg(format!("--profile-directory={profile_dir}"));
    if add_companion.unwrap_or(false) {
        cmd.arg(crate::extension_setup::config::store_listing_url());
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("could not launch {exe}: {e}"))
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
