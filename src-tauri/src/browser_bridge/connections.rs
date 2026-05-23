//! WebSocket connection registry — one live connection per extension profile.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use serde::Serialize;
use tokio::sync::mpsc;

use crate::browser_tabs::BrowserMediaCommand;

/// Outbound JSON frames to a connected extension profile.
pub type WsOutbound = mpsc::UnboundedSender<String>;

/// Key: extension `browserId` UUID.
pub type WsConnectionMap = Arc<Mutex<HashMap<String, WsOutbound>>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WsCommandPush {
    commands: Vec<WsCommandItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WsCommandItem {
    tab_id: i32,
    action: String,
}

pub fn new_ws_connection_map() -> WsConnectionMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn register_ws_connection(map: &WsConnectionMap, browser_id: &str, tx: WsOutbound) {
    if let Ok(mut connections) = map.lock() {
        connections.insert(browser_id.to_string(), tx);
    }
}

pub fn unregister_ws_connection(map: &WsConnectionMap, browser_id: &str) {
    if let Ok(mut connections) = map.lock() {
        connections.remove(browser_id);
    }
}

pub fn push_ws_frame(map: &WsConnectionMap, browser_id: &str, frame: &str) -> bool {
    if let Ok(connections) = map.lock() {
        if let Some(tx) = connections.get(browser_id) {
            return tx.send(frame.to_string()).is_ok();
        }
    }
    false
}

pub fn push_ws_command(
    map: &WsConnectionMap,
    browser_id: &str,
    cmd: &BrowserMediaCommand,
) -> bool {
    let frame = serde_json::to_string(&WsCommandPush {
        commands: vec![WsCommandItem {
            tab_id: cmd.tab_id,
            action: cmd.action.clone(),
        }],
    })
    .unwrap_or_else(|_| r#"{"commands":[]}"#.to_string());
    push_ws_frame(map, browser_id, &frame)
}

/// Profile UUIDs with a live WebSocket connection.
pub fn ws_connected_ids(map: &WsConnectionMap) -> HashSet<String> {
    map.lock()
        .ok()
        .map(|connections| connections.keys().cloned().collect())
        .unwrap_or_default()
}

pub fn push_ws_sync_all(map: &WsConnectionMap) {
    let frame = r#"{"syncNow":true,"commands":[]}"#;
    if let Ok(connections) = map.lock() {
        for tx in connections.values() {
            let _ = tx.send(frame.to_string());
        }
    }
}
