//! Local HTTP + WebSocket endpoints for the Chromium companion extension.
//! Each browser profile sends a stable `browserId`; the backend keeps one slot per
//! profile so multiple Chrome profiles never overwrite each other.

pub mod command;
pub mod connections;
mod handler;
mod http;
mod system_events;
mod ws;

pub use connections::{new_ws_connection_map, WsConnectionMap};
pub use handler::BridgeContext;
pub use system_events::spawn_power_listener;

pub const BROWSER_BRIDGE_PORT: u16 = 17_399;
pub const BROWSER_WS_PORT: u16 = 17_400;
pub const BROWSER_MEDIA_PATH: &str = "/browser-tabs";
pub const BROWSER_WS_PATH: &str = "/ws";

/// Shared atomic flag: set by `request_browser_sync` to tell the bridge to
/// include `syncNow: true` in the next POST/WS response.
pub type SyncRequestedFlag = std::sync::Arc<std::sync::atomic::AtomicBool>;

/// Spawn HTTP (fallback) and WebSocket (primary) bridge servers on one Tokio runtime.
pub fn spawn(
    browser_slots: crate::browser_tabs::BrowserSlotsMap,
    command_queue: crate::browser_tabs::BrowserCommandsQueue,
    app: tauri::AppHandle,
    gsmtc_slot: std::sync::Arc<std::sync::Mutex<Option<std::sync::Arc<crate::gsmtc::GsmtcState>>>>,
    detected_browsers: crate::browser_detector::DetectedBrowsersState,
    ext_store: crate::browser_detector::ExtensionInstalledState,
    reconnecting: crate::browser_detector::ReconnectingBrowsersState,
    sync_flag: SyncRequestedFlag,
    ws_connections: WsConnectionMap,
) {
    let ctx = std::sync::Arc::new(BridgeContext {
        browser_slots: std::sync::Arc::clone(&browser_slots),
        command_queue: std::sync::Arc::clone(&command_queue),
        app: app.clone(),
        gsmtc_slot: std::sync::Arc::clone(&gsmtc_slot),
        detected_browsers: std::sync::Arc::clone(&detected_browsers),
        ext_store: std::sync::Arc::clone(&ext_store),
        reconnecting: std::sync::Arc::clone(&reconnecting),
        sync_flag: std::sync::Arc::clone(&sync_flag),
    });

    std::thread::Builder::new()
        .name("browser-bridge".into())
        .spawn(move || {
            let rt = match tokio::runtime::Runtime::new() {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("[browser-bridge] runtime init failed: {e}");
                    return;
                }
            };

            rt.block_on(async move {
                let http_ctx = std::sync::Arc::clone(&ctx);
                let ws_ctx = ctx;
                let ws_map = ws_connections;

                tokio::join!(
                    http::run_http_server(http_ctx),
                    ws::run_ws_server(ws_ctx, ws_map),
                );
            });
        })
        .expect("spawn browser-bridge");

    spawn_power_listener(
        browser_slots,
        reconnecting,
        detected_browsers,
        ext_store,
        app,
    );
}
