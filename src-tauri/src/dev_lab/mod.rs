//! Dev-only commands: separate window and on-demand OS browser scan.

mod wake;
pub mod state;

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::browser_bridge::connections::{
    kill_ws_connection, push_ws_sync_all, ws_connected_ids, WsConnectionMap,
};
use crate::browser_bridge::{SyncRequestedFlag, CONNECTED_WINDOW_SECS};
use crate::browser_detector::{
    build_detected_browsers, emit_browsers_to_ui, DetectedBrowsersState,
    ExtensionInstalledState, ReconnectingBrowsersState,
};
use crate::browser_tabs::{BrowserSlot, BrowserSlotsMap};
use crate::browser_dto::BrowserTab;

const DEV_LAB_LABEL: &str = "dev-lab";
const POLL_INTERVAL_MS: u64 = 500;
const POLL_TIMEOUT_MS: u64 = 12_000;
const POST_CONNECT_WAIT_MS: u64 = 1_500;

pub use crate::browser_os_scan::DevOsBrowserScanRow as DevOsBrowserRow;

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
    crate::frontend::url(app, "index.html")
}

fn create_or_focus_dev_lab_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(DEV_LAB_LABEL) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = dev_lab_url(app);
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, DEV_LAB_LABEL, url)
        .title("PilPod Dev Lab")
        .inner_size(1280.0, 860.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .shadow(false);

    // Every window in the process must request the same WebView2 arguments or
    // environment creation fails — see `inapp_player::agent::BROWSER_ARGS`.
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args(crate::inapp_player::agent::BROWSER_ARGS);
    }

    let window = builder.build().map_err(|e| e.to_string())?;

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
    let rows = crate::browser_os_scan::build_dev_os_browser_rows();

    // Keep the shared detector cache in sync for wake/sync and dashboard merge.
    let fresh = build_detected_browsers();
    {
        let mut lock = detected.lock().unwrap_or_else(|e| e.into_inner());
        *lock = fresh;
    }

    emit_browsers_to_ui(
        &app,
        &detected,
        &slots,
        &ext_store,
        &reconnecting,
        &ws_connections,
    );

    rows
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
    slot.effective_os_id()
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

// ── Dev Lab v2 commands ──────────────────────────────────────────────────────

/// Assemble everything the Dev Lab shows in one call: OS truth, raw slots,
/// and the merged dashboard payload, side by side.
#[tauri::command]
pub fn dev_get_full_state(
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    ws_connections: State<'_, WsConnectionMap>,
    app: tauri::AppHandle,
) -> state::DevFullState {
    let os_rows = crate::browser_os_scan::build_dev_os_browser_rows();

    let slot_rows = {
        let slots_map = slots.lock().unwrap_or_else(|e| e.into_inner());
        let store = ext_store.lock().unwrap_or_else(|e| e.into_inner());
        let reconnecting_set = reconnecting.lock().unwrap_or_else(|e| e.into_inner());
        let ws_connected = ws_connected_ids(&ws_connections);
        state::build_dev_slot_rows(
            &slots_map,
            &ws_connected,
            &reconnecting_set,
            &|os_id| store.is_installed(os_id),
            Instant::now(),
            Duration::from_secs(CONNECTED_WINDOW_SECS),
        )
    };

    let merged = crate::browser_detector::build_browsers_payload(
        &detected,
        &slots,
        &ext_store,
        &reconnecting,
        &ws_connections,
        &crate::extension_setup::snapshot_from_app(&app),
    );

    state::DevFullState {
        generated_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        os_rows,
        slots: slot_rows,
        merged,
    }
}

/// Forcibly drop a live WS session (simulate a disconnect). Returns `true`
/// when a session existed; normal teardown then marks the slot reconnecting.
#[tauri::command]
pub fn dev_kill_ws(
    browser_id: String,
    ws_connections: State<'_, WsConnectionMap>,
) -> bool {
    kill_ws_connection(&ws_connections, &browser_id)
}

/// Forget the persisted "extension installed" flag for an OS browser id.
#[tauri::command]
pub fn dev_clear_ext_installed(
    os_browser_id: String,
    app: AppHandle,
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    ws_connections: State<'_, WsConnectionMap>,
) -> bool {
    let cleared = ext_store
        .lock()
        .ok()
        .map(|mut store| store.clear(&os_browser_id))
        .unwrap_or(false);

    if cleared {
        emit_browsers_to_ui(
            &app,
            &detected,
            &slots,
            &ext_store,
            &reconnecting,
            &ws_connections,
        );
    }
    cleared
}

/// Drop the bundled-icon data-URL cache (pick up replaced PNGs without restart).
#[tauri::command]
pub fn dev_clear_icon_cache() {
    crate::browser_icon::clear_cache();
}

// ── Phase 5 scenario actions ─────────────────────────────────────────────────

/// Inject a fully-stale fake slot for `os_browser_id` (simulates an extension
/// reinstall leaving a dead UUID behind). Returns the injected slot id.
#[tauri::command]
pub fn dev_inject_stale_slot(
    os_browser_id: String,
    app: AppHandle,
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    ws_connections: State<'_, WsConnectionMap>,
) -> String {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let slot_id = format!("stale-sim-{os_browser_id}-{stamp}");

    let stale_age = Duration::from_secs(crate::browser_detector::SLOT_GC_SECS + 60);
    let slot = BrowserSlot {
        last_seen: Instant::now() - stale_age,
        browser_id: slot_id.clone(),
        browser_name: os_browser_id.clone(),
        verified_os_id: Some(os_browser_id),
        tabs: vec![BrowserTab {
            tab_id: 1,
            window_id: 1,
            title: "SIM stale tab (should be GC'd)".into(),
            url: "https://example.com/stale".into(),
            ..Default::default()
        }],
        content_hash: 0,
    };

    if let Ok(mut map) = slots.lock() {
        map.insert(slot_id.clone(), slot);
    }
    emit_browsers_to_ui(&app, &detected, &slots, &ext_store, &reconnecting, &ws_connections);
    slot_id
}

/// Run slot GC immediately (normal TTL). Returns removed slot ids.
#[tauri::command]
pub fn dev_gc_slots_now(
    app: AppHandle,
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    ws_connections: State<'_, WsConnectionMap>,
) -> Vec<String> {
    let removed = {
        let mut map = slots.lock().unwrap_or_else(|e| e.into_inner());
        crate::browser_detector::gc_stale_slots(
            &mut map,
            Instant::now(),
            Duration::from_secs(crate::browser_detector::SLOT_GC_SECS),
        )
    };
    if !removed.is_empty() {
        if let Ok(mut set) = reconnecting.lock() {
            for id in &removed {
                set.remove(id);
            }
        }
        emit_browsers_to_ui(&app, &detected, &slots, &ext_store, &reconnecting, &ws_connections);
    }
    removed
}

/// Simulate a system resume: all slots marked stale + reconnecting, exactly
/// like the power listener does. Returns the number of affected slots.
#[tauri::command]
pub fn dev_simulate_resume(
    app: AppHandle,
    detected: State<'_, DetectedBrowsersState>,
    slots: State<'_, BrowserSlotsMap>,
    ext_store: State<'_, ExtensionInstalledState>,
    reconnecting: State<'_, ReconnectingBrowsersState>,
    ws_connections: State<'_, WsConnectionMap>,
) -> usize {
    let count = slots.lock().map(|m| m.len()).unwrap_or(0);
    crate::browser_bridge::invalidate_slots_on_resume(&slots, &reconnecting);
    emit_browsers_to_ui(&app, &detected, &slots, &ext_store, &reconnecting, &ws_connections);
    count
}


