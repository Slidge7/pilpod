//! Dev-only commands: separate window and on-demand OS browser scan.

mod wake;

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::browser_bridge::connections::{push_ws_sync_all, ws_connected_ids, WsConnectionMap};
use crate::browser_bridge::{SyncRequestedFlag, CONNECTED_WINDOW_SECS};
use crate::browser_detector::{
    browser_name_to_id, build_detected_browsers, emit_browsers_to_ui, DetectedBrowsersState,
    ExtensionInstalledState, ReconnectingBrowsersState,
};
use crate::browser_tabs::{BrowserSlot, BrowserSlotsMap};
use crate::gsmtc::dto::BrowserTab;

const DEV_LAB_LABEL: &str = "dev-lab";
const POLL_INTERVAL_MS: u64 = 500;
const POLL_TIMEOUT_MS: u64 = 12_000;
const POST_CONNECT_WAIT_MS: u64 = 1_500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevOsBrowserRow {
    pub id: String,
    pub display_name: String,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevBrowserTabProfile {
    pub browser_id: String,
    pub os_browser_id: String,
    pub extension_connected: bool,
    pub tab_count: usize,
    pub tabs: Vec<BrowserTab>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevWakeAndSyncResult {
    pub os_browser_id: String,
    pub was_running: bool,
    pub launched: bool,
    pub connected: bool,
    pub timed_out: bool,
    pub wait_ms: u64,
    pub profiles: Vec<DevBrowserTabProfile>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn open_dev_lab_window(app: AppHandle) -> Result<(), String> {
    // Window creation must not run on the WebView thread (deadlocks on Windows).
    tauri::async_runtime::spawn_blocking(move || create_or_focus_dev_lab_window(&app))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

fn dev_lab_url(app: &AppHandle) -> WebviewUrl {
    if let Some(dev_url) = app.config().build.dev_url.clone() {
        return WebviewUrl::External(dev_url);
    }
    WebviewUrl::App("index.html".into())
}

fn create_or_focus_dev_lab_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(DEV_LAB_LABEL) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = dev_lab_url(app);
    let window = WebviewWindowBuilder::new(app, DEV_LAB_LABEL, url)
        .title("PilPod Dev Lab")
        .inner_size(420.0, 520.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .build()
        .map_err(|e| e.to_string())?;

    if let Err(e) = window.set_icon(tauri::include_image!("icons/icon.ico")) {
        eprintln!("[dev-lab] window icon: {e}");
    }

    Ok(())
}

#[tauri::command]
pub fn dev_scan_os_browsers(
    app: AppHandle,
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    ws_connections: State<'_, WsConnectionMap>,
) -> Vec<DevOsBrowserRow> {
    let fresh = build_detected_browsers();
    {
        let mut lock = detected.lock().unwrap_or_else(|e| e.into_inner());
        *lock = fresh.clone();
    }

    emit_browsers_to_ui(
        &app,
        &detected,
        &slots,
        &ext_store,
        &reconnecting,
        &ws_connections,
    );

    fresh
        .into_iter()
        .map(|b| DevOsBrowserRow {
            id: b.id,
            display_name: b.display_name,
            running: b.running,
        })
        .collect()
}

#[tauri::command]
pub async fn dev_wake_and_sync_browser(
    os_browser_id: String,
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    ws_connections: State<'_, WsConnectionMap>,
    sync_flag: State<'_, SyncRequestedFlag>,
) -> Result<DevWakeAndSyncResult, String> {
    let os_id = os_browser_id.clone();
    let detected = detected.inner().clone();
    let slots = slots.inner().clone();
    let ext_store = ext_store.inner().clone();
    let ws_connections = ws_connections.inner().clone();
    let sync_flag = sync_flag.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        wake_and_sync_impl(
            &os_id,
            &detected,
            &slots,
            &ext_store,
            &ws_connections,
            &sync_flag,
        )
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

fn is_browser_running(os_browser_id: &str, detected: &DetectedBrowsersState) -> bool {
    detected
        .lock()
        .ok()
        .and_then(|list| {
            list.iter()
                .find(|b| b.id == os_browser_id)
                .map(|b| b.running)
        })
        .unwrap_or(false)
}

fn slot_os_id(slot: &BrowserSlot) -> String {
    browser_name_to_id(&slot.browser_name)
}

fn slot_is_recently_seen(slot: &BrowserSlot, now: Instant, cutoff: Duration) -> bool {
    now.duration_since(slot.last_seen) < cutoff
}

fn is_any_profile_connected(
    os_browser_id: &str,
    slots_map: &BrowserSlotsMap,
    ws_connections: &WsConnectionMap,
) -> bool {
    let connected_ids = ws_connected_ids(ws_connections);
    let cutoff = Duration::from_secs(CONNECTED_WINDOW_SECS);
    let now = Instant::now();

    slots_map
        .lock()
        .ok()
        .map(|slots| {
            // Live WebSocket for any profile of this OS browser.
            for id in &connected_ids {
                if let Some(slot) = slots.get(id) {
                    if slot_os_id(slot) == os_browser_id {
                        return true;
                    }
                }
            }

            // HTTP heartbeat fallback (no live WS).
            slots.values().any(|slot| {
                slot_os_id(slot) == os_browser_id && slot_is_recently_seen(slot, now, cutoff)
            })
        })
        .unwrap_or(false)
}

fn collect_profiles(
    os_browser_id: &str,
    slots_map: &BrowserSlotsMap,
    ws_connections: &WsConnectionMap,
) -> Vec<DevBrowserTabProfile> {
    let connected_ids = ws_connected_ids(ws_connections);
    let cutoff = Duration::from_secs(CONNECTED_WINDOW_SECS);
    let now = Instant::now();

    slots_map
        .lock()
        .ok()
        .map(|slots| {
            slots
                .values()
                .filter(|slot| slot_os_id(slot) == os_browser_id)
                .map(|slot| DevBrowserTabProfile {
                    browser_id: slot.browser_id.clone(),
                    os_browser_id: os_browser_id.to_string(),
                    extension_connected: connected_ids.contains(&slot.browser_id)
                        || slot_is_recently_seen(slot, now, cutoff),
                    tab_count: slot.tabs.len(),
                    tabs: slot.tabs.clone(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn wake_and_sync_impl(
    os_browser_id: &str,
    detected: &DetectedBrowsersState,
    slots_map: &BrowserSlotsMap,
    ext_store: &ExtensionInstalledState,
    ws_connections: &WsConnectionMap,
    sync_flag: &SyncRequestedFlag,
) -> Result<DevWakeAndSyncResult, String> {
    // Refresh OS process scan — dev_scan may be stale.
    {
        let fresh = build_detected_browsers();
        if let Ok(mut lock) = detected.lock() {
            *lock = fresh;
        }
    }

    let was_running = is_browser_running(os_browser_id, detected);
    let mut launched = false;

    let ext_installed = ext_store
        .lock()
        .ok()
        .map(|store| store.is_installed(os_browser_id))
        .unwrap_or(false);

    if !ext_installed {
        return Ok(DevWakeAndSyncResult {
            os_browser_id: os_browser_id.to_string(),
            was_running,
            launched: false,
            connected: false,
            timed_out: false,
            wait_ms: 0,
            profiles: collect_profiles(os_browser_id, slots_map, ws_connections),
            error: Some("Extension not installed for this browser".to_string()),
        });
    }

    let already_connected =
        is_any_profile_connected(os_browser_id, slots_map, ws_connections);

    // Launch (or re-launch) the browser exe to wake a suspended MV3 service worker.
    // Re-launch is a no-focus nudge when the process is already running.
    if !already_connected {
        match wake::resolve_exe_path(os_browser_id) {
            Some(exe) => {
                wake::launch_no_focus(&exe)?;
                launched = !was_running;
            }
            None => {
                return Ok(DevWakeAndSyncResult {
                    os_browser_id: os_browser_id.to_string(),
                    was_running,
                    launched: false,
                    connected: false,
                    timed_out: false,
                    wait_ms: 0,
                    profiles: vec![],
                    error: Some(format!("Cannot resolve exe path for '{os_browser_id}'")),
                });
            }
        }
    }

    let start = Instant::now();
    let mut connected = already_connected;

    while !connected {
        if is_any_profile_connected(os_browser_id, slots_map, ws_connections) {
            connected = true;
            break;
        }
        if start.elapsed().as_millis() as u64 >= POLL_TIMEOUT_MS {
            break;
        }
        std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
    }

    let wait_ms = start.elapsed().as_millis() as u64;

    if connected {
        sync_flag.store(true, Ordering::Relaxed);
        push_ws_sync_all(ws_connections);
        std::thread::sleep(Duration::from_millis(POST_CONNECT_WAIT_MS));
    }

    let profiles = collect_profiles(os_browser_id, slots_map, ws_connections);

    Ok(DevWakeAndSyncResult {
        os_browser_id: os_browser_id.to_string(),
        was_running,
        launched,
        connected,
        timed_out: !connected,
        wait_ms,
        profiles,
        error: None,
    })
}


