//! WebSocket connection registry — the `SessionManager` that owns one live
//! session per extension profile.
//!
//! This is the "actor registry" half of the Hybrid state model: every live
//! extension connection is represented by exactly one [`Connection`] owned by a
//! single [`SessionManager`], and *all* register / lookup / push / broadcast
//! goes through that manager. The per-connection reader/writer loop still lives
//! on its own task in `ws.rs` (that task is the connection's "actor"); this type
//! is the authoritative directory those actors register themselves in.
//!
//! Outbound frames use protocol v2 (`/PROTOCOL.md`): commands are pushed as
//! `cmd` frames immediately (no draining), and a global resync request uses the
//! `resync` frame.
//!
//! ## Drop-in compatibility
//! The public surface is deliberately unchanged from the previous bare
//! `Arc<Mutex<HashMap<..>>>`: `WsConnectionMap` is still an `Arc<..>` (so the
//! existing `Arc::clone` / `tauri::State` / `.manage()` call sites keep
//! compiling verbatim), and every free function keeps its old signature and
//! simply delegates to a `SessionManager` method. Only the internals changed.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use tokio::sync::mpsc;

use crate::browser_tabs::BrowserMediaCommand;

use super::protocol::frames::ServerMsg;
use super::security::action_from_str;

/// Outbound JSON frames to a connected extension profile.
pub type WsOutbound = mpsc::UnboundedSender<String>;

/// One live extension connection, owned exclusively by the [`SessionManager`].
///
/// Kept as a struct (rather than a bare sender) so per-connection bookkeeping
/// can grow — e.g. last-seen, negotiated caps, subscribed tabs — without
/// touching the registry's public API again.
#[derive(Debug)]
struct Connection {
    /// Sink for frames destined to this profile's WebSocket writer task.
    out: WsOutbound,
}

impl Connection {
    fn send(&self, frame: &str) -> bool {
        self.out.send(frame.to_string()).is_ok()
    }
}

/// Authoritative directory of live extension connections, keyed by the
/// extension `browserId` UUID. A single instance is shared (behind `Arc`) by the
/// bridge servers and every Tauri command that needs to reach a browser.
#[derive(Debug, Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, Connection>>,
}

impl SessionManager {
    fn register(&self, browser_id: &str, out: WsOutbound) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(browser_id.to_string(), Connection { out });
        }
    }

    fn unregister(&self, browser_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(browser_id);
        }
    }

    /// Send one already-serialized frame to a specific profile. Returns false
    /// when the browser has no live session (or its writer task has gone away).
    fn send_to(&self, browser_id: &str, frame: &str) -> bool {
        if let Ok(sessions) = self.sessions.lock() {
            if let Some(conn) = sessions.get(browser_id) {
                return conn.send(frame);
            }
        }
        false
    }

    fn connected_ids(&self) -> HashSet<String> {
        self.sessions
            .lock()
            .ok()
            .map(|sessions| sessions.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Send the same frame to every live session (best effort).
    fn broadcast(&self, frame: &str) {
        if let Ok(sessions) = self.sessions.lock() {
            for conn in sessions.values() {
                let _ = conn.send(frame);
            }
        }
    }

    /// Forcibly drop a live session (dev-lab: simulate a WS drop).
    ///
    /// Removing the [`Connection`] drops its outbound sender; the writer task's
    /// `out_rx.recv()` then yields `None`, the select loop breaks, and normal
    /// teardown (reconnecting flag, slot staleness, UI emit) runs in `ws.rs`.
    /// Returns `true` when a session existed.
    fn kill(&self, browser_id: &str) -> bool {
        self.sessions
            .lock()
            .ok()
            .map(|mut sessions| sessions.remove(browser_id).is_some())
            .unwrap_or(false)
    }
}

/// Shared handle type. Still an `Arc<..>` so existing `Arc::clone`, `.manage`,
/// and `State<'_, WsConnectionMap>` call sites are unaffected.
pub type WsConnectionMap = Arc<SessionManager>;

pub fn new_ws_connection_map() -> WsConnectionMap {
    Arc::new(SessionManager::default())
}

pub fn register_ws_connection(map: &WsConnectionMap, browser_id: &str, tx: WsOutbound) {
    map.register(browser_id, tx);
}

pub fn unregister_ws_connection(map: &WsConnectionMap, browser_id: &str) {
    map.unregister(browser_id);
}

/// Dev-lab: forcibly close a live WS session. Returns `true` if one existed.
pub fn kill_ws_connection(map: &WsConnectionMap, browser_id: &str) -> bool {
    map.kill(browser_id)
}

/// Push a single control as an immediate v2 `cmd` frame. Returns false when the
/// browser has no live socket (caller may then fall back to the command queue).
pub fn push_ws_command(
    map: &WsConnectionMap,
    browser_id: &str,
    cmd: &BrowserMediaCommand,
) -> bool {
    let Some(action) = action_from_str(&cmd.action) else {
        return false;
    };
    let frame = ServerMsg::Cmd {
        id: format!("c-{}", cmd.tab_id),
        tab_id: cmd.tab_id as i64,
        action,
        value: cmd.value,
    }
    .to_frame();
    map.send_to(browser_id, &frame)
}

/// Profile UUIDs with a live WebSocket connection.
pub fn ws_connected_ids(map: &WsConnectionMap) -> HashSet<String> {
    map.connected_ids()
}

/// Ask every connected browser to re-send a full snapshot (v2 `resync`).
pub fn push_ws_sync_all(map: &WsConnectionMap) {
    map.broadcast(&ServerMsg::Resync.to_frame());
}
