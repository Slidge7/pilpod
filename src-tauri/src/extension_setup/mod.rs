//! Extension Setup — detect browsers, guide the user through installing the
//! PilPod Companion from the Chrome Web Store, and verify the result.
//!
//! ISOLATION CONTRACT (mirrors `vault/mod.rs` and `downloader/mod.rs`): this
//! module is self-contained. Its integration points are exactly:
//!
//! * `lib.rs`            — mod declaration
//! * `app/handlers.rs`   — command registration
//! * `app/setup.rs`      — managed state init
//! * `browser_detector`  — reads activation state when building the UI payload
//! * `browser_bridge`    — emits [`activation::ActivationEvent::HandshakeVerified`]
//!
//! It must never reach into bridge/detector internals in the other direction;
//! it exposes `apply_event` and a read-only view, nothing more.
//!
//! # Why the state machine and not a bool
//!
//! The old `extension_installed: bool` could not distinguish "never set up" from
//! "user is mid-install" from "extension was removed", so the UI could not say
//! anything useful and the onboarding flow had nothing to hang off. See
//! `plans/EXTENSION_SETUP_PLAN.md`.
//!
//! # Install model
//!
//! The companion is an **unlisted Chrome Web Store item**. Setup is: launch the
//! user's chosen browser at the listing URL → they click "Add to <Browser>" →
//! the extension connects to the bridge → peer-PID attribution proves *which*
//! browser it was → that browser flips to `Active`. No Developer Mode, no
//! unpacked folder, no bundled extension resources.

pub mod activation;
#[cfg(windows)]
pub mod commands;
pub mod config;
pub mod engine;
pub mod launcher;
pub mod service;
pub mod store;
pub mod verify;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub use activation::{ActivationEvent, ActivationState};
pub use store::ActivationStore;
pub use verify::ActivationSnapshot;

/// Shared, thread-safe handle to the activation store (Tauri managed state).
pub type ActivationStoreHandle = Arc<Mutex<ActivationStore>>;

/// Load the activation store from the app data dir, migrating the legacy
/// `browser_ext_state.json` on first run.
///
/// This is the module's only Tauri touchpoint — `store.rs` stays framework-free
/// (plain paths in, plain data out) so it can be unit-tested without an
/// `AppHandle`, and so swapping the persistence layer later stays a one-file job.
pub fn load_store(app: &tauri::AppHandle) -> ActivationStore {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let (path, legacy) = ActivationStore::paths_in(&dir);
    store::load_from(&path, &legacy)
}

/// Wall-clock milliseconds since the Unix epoch. Used for activation
/// timestamps only — ordering, never security.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Apply an activation event through the shared handle.
///
/// Returns `true` when the state actually changed, which callers use to decide
/// whether to re-emit `browsers://update`. A poisoned lock is treated as "no
/// change" rather than a panic: activation is UX state, never worth taking the
/// app down for.
pub fn apply_event(
    handle: &ActivationStoreHandle,
    browser_id: &str,
    event: ActivationEvent,
) -> bool {
    match handle.lock() {
        Ok(mut store) => store.apply(browser_id, event, now_ms()),
        Err(e) => {
            log::warn!("[extension-setup] activation store lock poisoned: {e}");
            false
        }
    }
}

/// Read one browser's state through the shared handle. Falls back to
/// `Inactive` if the lock is poisoned — fail closed, never fake an activation.
pub fn state_of(handle: &ActivationStoreHandle, browser_id: &str) -> ActivationState {
    handle
        .lock()
        .map(|s| s.state_of(browser_id))
        .unwrap_or_default()
}

/// Snapshot every browser's activation state from Tauri managed state.
///
/// This is how the browser-payload path gets activation data without threading
/// a seventh parameter through thirteen call sites of `emit_browsers_to_ui`.
///
/// **Failure mode, deliberately chosen:** if managed state is missing (only
/// possible if `app/setup.rs` did not register it) we return an empty snapshot,
/// which reads as "everything Inactive". That locks the dashboard rather than
/// unlocking browsers we cannot vouch for — wrong in the safe direction — and
/// logs loudly, because it can only ever be a wiring bug.
pub fn snapshot_from_app(app: &tauri::AppHandle) -> ActivationSnapshot {
    use tauri::Manager;
    let Some(handle) = app.try_state::<ActivationStoreHandle>() else {
        log::error!(
            "[extension-setup] activation store not registered — \
             every browser will render as inactive"
        );
        return ActivationSnapshot::default();
    };
    // Bound to a local rather than returned as the tail expression: the
    // `MutexGuard` temporary would otherwise outlive `handle` (E0597).
    let snapshot = match handle.lock() {
        Ok(store) => store.snapshot(),
        Err(e) => {
            log::warn!("[extension-setup] activation store lock poisoned: {e}");
            ActivationSnapshot::default()
        }
    };
    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handle() -> ActivationStoreHandle {
        Arc::new(Mutex::new(ActivationStore::default()))
    }

    #[test]
    fn apply_event_reports_changes_through_the_handle() {
        let h = handle();
        assert_eq!(state_of(&h, "chrome"), ActivationState::Inactive);
        assert!(apply_event(&h, "chrome", ActivationEvent::HandshakeVerified));
        assert_eq!(state_of(&h, "chrome"), ActivationState::Active);
        assert!(!apply_event(&h, "chrome", ActivationEvent::HandshakeVerified));
    }

    #[test]
    fn state_of_fails_closed_on_a_poisoned_lock() {
        let h = handle();
        apply_event(&h, "chrome", ActivationEvent::HandshakeVerified);

        let poisoner = Arc::clone(&h);
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.lock().unwrap();
            panic!("poison the mutex");
        })
        .join();

        assert!(h.is_poisoned());
        assert_eq!(
            state_of(&h, "chrome"),
            ActivationState::Inactive,
            "a poisoned lock must never report a browser as active"
        );
        assert!(!apply_event(&h, "chrome", ActivationEvent::SetupStarted));
    }

    #[test]
    fn now_ms_is_a_plausible_epoch_timestamp() {
        // Sanity floor: 2020-01-01. Guards against a units mix-up (secs vs ms).
        assert!(now_ms() > 1_577_836_800_000);
    }
}
