//! Vault — local bookmarks & media playlists (FREE feature).
//!
//! ISOLATION CONTRACT (mirrors `downloader/mod.rs`): this module is strictly
//! self-contained. Its only integration points are exactly `lib.rs` (mod decl),
//! `app/handlers.rs` (command registration) and `app/mod.rs` (init call + exit
//! flush). The vault must NEVER import from `browser_bridge`, `browser_tabs`,
//! `browser_commands`, `browser_detector`, `downloader`, or `audio_mixer`
//! internals — the frontend hands it plain provenance strings captured from
//! `browsers://update`, and the backend never reaches back into browser state.
//! The single deliberate exception is Phase 5's `open.rs` (`#[cfg(windows)]`),
//! which is the one file allowed to call the focus/shell-open seam.
//!
//! Platform-neutral: pure file I/O, compiled on all platforms (only the Phase 5
//! open command is Windows-gated). Persistence is a single versioned JSON file
//! via `store.rs` — no database, no new crates.
//!
//! Event: `vault://update` carries the full serialized vault (camelCase DTO),
//! emitted at startup and after any mutation that changes content
//! (diff-before-emit). Rust is the source of truth; the frontend hydrates via
//! `vault_get_state` then trusts events.

pub mod commands;
pub mod dto;
#[cfg(windows)]
pub mod open;
pub mod state;
pub mod store;
pub mod url;

use std::time::Duration;
use tauri::{Emitter, Manager};

use state::{VaultState, VaultStateHandle};

/// Full-snapshot update event (camelCase [`dto::VaultData`]).
pub const EVT_UPDATE: &str = "vault://update";

/// How long the persist thread coalesces a burst of mutations before writing.
const PERSIST_INTERVAL_MS: u64 = 500;

/// Wall-clock milliseconds since the Unix epoch. Used for timestamps and the
/// corruption-backup suffix. Monotonic enough for ordering; not for security.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Emit `vault://update` with the current snapshot, but only if the content
/// hash changed since the last emit. Safe to call after every mutation.
pub fn emit_update(handle: &tauri::AppHandle, state: &VaultState) {
    if !state.should_emit() {
        return;
    }
    let snapshot = state.snapshot();
    if let Err(e) = handle.emit(EVT_UPDATE, snapshot) {
        log::warn!("[vault] emit update failed: {e}");
    }
}

/// Persist the vault now if it has unsaved changes. Called from the app's
/// `RunEvent::Exit` arm so the final burst of edits is never lost. Best effort.
pub fn flush(handle: &tauri::AppHandle) {
    let Some(state) = handle.try_state::<VaultStateHandle>() else {
        return;
    };
    if state.take_dirty() {
        let data = state.data_clone();
        if let Err(e) = store::save(handle, &data) {
            log::warn!("[vault] exit flush failed: {e}");
        }
    }
}

/// Startup init: load the store into memory, register managed state, spawn the
/// debounced persist thread, and emit the initial snapshot. Never fails the app
/// — any load problem degrades to an empty vault inside `store::load`.
pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let data = store::load(&handle);
    log::info!(
        "[vault] init: {} bookmark(s), {} media item(s), {} playlist(s)",
        data.bookmarks.len(),
        data.media_items.len(),
        data.playlists.len()
    );

    let state: VaultStateHandle = std::sync::Arc::new(VaultState::new(data));
    app.manage(std::sync::Arc::clone(&state));

    // Debounced persist thread: coalesces bursts (e.g. playlist reordering) into
    // one atomic write ~500 ms after the last change. On save failure the dirty
    // flag is re-armed so the next tick retries.
    {
        let state = std::sync::Arc::clone(&state);
        let handle = handle.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(PERSIST_INTERVAL_MS));
            if state.take_dirty() {
                let data = state.data_clone();
                if let Err(e) = store::save(&handle, &data) {
                    log::warn!("[vault] persist failed: {e} — will retry");
                    state.set_dirty();
                }
            }
        });
    }

    // Initial hydration snapshot (first should_emit is always true).
    emit_update(&handle, &state);
    Ok(())
}
