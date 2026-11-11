//! History — PilPod's own record of the pages and media its browsers showed.
//!
//! Built entirely from data PilPod already has. Every `browsers://update`
//! payload the dashboard receives is also handed to [`observe`]; the recorder
//! derives page visits and media plays from how that payload changes over
//! time. Nothing is read from the browsers' own history databases, and the
//! companion extension needs no new permission or protocol message.
//!
//! ISOLATION CONTRACT (same spirit as the vault's):
//!   * Integration points are `lib.rs` (mod decl), `app/handlers.rs` (command
//!     registration), `app/mod.rs` (init + exit flush) and exactly ONE call in
//!     `browser_detector::emit_browsers_to_ui` — the feed.
//!   * The feed is the merged `DetectedBrowser` list: plain DTOs, the same
//!     view the user sees. History never reaches into slots, sockets or the
//!     bridge, so "what was open" can never disagree with what was on screen.
//!   * `open.rs` (Windows) is the single seam back into the browser subsystem,
//!     via the shared `browser_open` helper the vault uses too.
//!
//! Only browsers the user verified (`activationState == active`) with a live
//! connection are recorded. Recording can be paused, and every row deleted,
//! from the History panel.
//!
//! Threads: observing runs on whichever thread emitted the payload and only
//! touches memory. A dedicated `history` thread ticks every [`TICK_INTERVAL`],
//! flushing rows to SQLite and emitting [`EVT_CHANGED`] when anything moved.
//!
//! Layout: `recorder` (pure state machine) → `service` (locking, lifecycle)
//! → `store` (SQLite). Only this file and `commands`/`open` know about Tauri.

pub mod commands;
pub mod model;
#[cfg(windows)]
pub mod open;
pub mod recorder;
pub mod service;
pub mod store;

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::browser_dto::DetectedBrowser;
use crate::extension_setup::ActivationState;
use recorder::BrowserObservation;
use service::HistoryService;

/// Stored history changed (rows added, updated or removed). No payload — the
/// panel re-queries whatever it is showing.
pub const EVT_CHANGED: &str = "history://changed";

const TICK_INTERVAL: Duration = Duration::from_secs(2);

pub type HistoryHandle = Arc<HistoryService>;

/// Managed state. `None` when the database could not be opened this session:
/// the app runs normally and history commands answer `history_unavailable`.
pub struct HistoryState(pub Option<HistoryHandle>);

/// Wall-clock milliseconds since the Unix epoch.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Open the database, register state and start the tick thread. Never fails
/// the app — a broken history must not take the dashboard down with it.
pub fn init(app: &mut tauri::App) {
    let handle = app.handle().clone();
    let service = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))
        .and_then(|dir| store::HistoryStore::open(&dir.join(store::FILE_NAME)))
        .and_then(|store| HistoryService::start(store, now_ms()));

    let service = match service {
        Ok(service) => Arc::new(service),
        Err(e) => {
            log::warn!("[history] unavailable this session: {e}");
            app.manage(HistoryState(None));
            return;
        }
    };
    app.manage(HistoryState(Some(Arc::clone(&service))));

    let spawned = std::thread::Builder::new()
        .name("history".into())
        .spawn(move || loop {
            std::thread::sleep(TICK_INTERVAL);
            match service.tick(now_ms()) {
                Ok(true) => notify_changed(&handle),
                Ok(false) => {}
                Err(e) => log::warn!("[history] tick failed: {e} — will retry"),
            }
        });
    if let Err(e) = spawned {
        log::warn!("[history] could not start the recorder thread: {e}");
    }
}

/// The feed. Called with every merged browser list the dashboard is sent.
// The only caller (`browser_detector`) is Windows-only, like the bridge itself.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn observe(app: &AppHandle, browsers: &[DetectedBrowser]) {
    let Some(service) = service(app) else {
        return;
    };
    service.observe(
        now_ms(),
        browsers
            .iter()
            .filter(|b| is_recordable(b))
            .map(|b| BrowserObservation {
                browser_id: &b.id,
                os_browser_id: &b.os_browser_id,
                browser_name: b.profile_label.as_deref().unwrap_or(&b.display_name),
                tabs: &b.tabs,
            }),
    );
}

/// End every open row and write it out. Called from `RunEvent::Exit`.
pub fn flush(app: &AppHandle) {
    if let Some(service) = service(app) {
        if let Err(e) = service.shutdown(now_ms()) {
            log::warn!("[history] exit flush failed: {e}");
        }
    }
}

pub(crate) fn notify_changed(app: &AppHandle) {
    if let Err(e) = app.emit(EVT_CHANGED, ()) {
        log::warn!("[history] emit failed: {e}");
    }
}

fn service(app: &AppHandle) -> Option<HistoryHandle> {
    app.try_state::<HistoryState>()?.0.clone()
}

/// A browser is recorded only while the user can actually see it: verified,
/// and connected right now. Cached tabs of a disconnected browser are stale.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_recordable(browser: &DetectedBrowser) -> bool {
    browser.extension_connected && browser.activation_state == ActivationState::Active
}

#[cfg(test)]
mod tests {
    use super::*;

    fn browser(connected: bool, state: ActivationState) -> DetectedBrowser {
        serde_json::from_value(serde_json::json!({
            "id": "p1",
            "osBrowserId": "chrome",
            "displayName": "Chrome",
            "running": true,
            "extensionInstalled": true,
            "activationState": state,
            "extensionConnected": connected,
            "tabCount": 0,
            "tabs": [],
        }))
        .expect("browser fixture")
    }

    #[test]
    fn only_verified_connected_browsers_are_recorded() {
        assert!(is_recordable(&browser(true, ActivationState::Active)));
        assert!(!is_recordable(&browser(false, ActivationState::Active)));
        assert!(!is_recordable(&browser(true, ActivationState::Inactive)));
        assert!(!is_recordable(&browser(true, ActivationState::Revoked)));
    }
}
