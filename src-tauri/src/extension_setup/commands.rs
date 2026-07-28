//! Tauri command surface — translation only.
//!
//! Each command: unlock managed state → call a `service.rs` function → map the
//! typed error to a string. No decisions are made here, which is why there are
//! no tests in this file; the logic they would cover lives in `service.rs` and
//! is tested there against `MockOps`.
//!
//! Windows-only: every command needs a real browser to launch, and browser
//! detection is Win32. The module is registered from `app/handlers.rs`.

use tauri::State;

use super::launcher::{BrowserOps, SystemOps};
use super::service::{self, BrowserFacts, SetupOverview};
use super::{now_ms, ActivationStoreHandle};

/// Lock the store, run `f`, and turn a poisoned mutex into a plain error rather
/// than a panic that would take down the command thread.
fn with_store<T>(
    state: &ActivationStoreHandle,
    f: impl FnOnce(&mut super::ActivationStore) -> T,
) -> Result<T, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "activation store unavailable".to_string())?;
    Ok(f(&mut guard))
}

/// Assemble the per-browser facts the overview needs.
///
/// Uses the detector's cached browser list (already refreshed on its own loop)
/// rather than rescanning, so opening the setup screen costs nothing. The
/// on-disk extension probe *is* done live — it is cheap, and it is the signal
/// that distinguishes "not installed" from "installed but not connected".
fn collect_facts() -> Vec<BrowserFacts> {
    crate::browser_detector::build_detected_browsers()
        .into_iter()
        .map(|d| BrowserFacts {
            icon_url: crate::browser_icon::data_url_for_browser(&d.id),
            extension_on_disk: crate::browser_os_scan::scan_os_extension_installed(&d.id),
            id: d.id,
            display_name: d.display_name,
            running: d.running,
        })
        .collect()
}

/// Everything the setup screen renders, in one round trip.
#[tauri::command]
pub fn extension_setup_overview(
    state: State<'_, ActivationStoreHandle>,
) -> Result<SetupOverview, String> {
    let facts = collect_facts();
    with_store(&state, |store| {
        service::build_overview(&facts, store, &SystemOps)
    })
}

/// Launch the given browser at the Chrome Web Store listing. Returns the URL.
#[tauri::command]
pub fn extension_setup_open_listing(
    state: State<'_, ActivationStoreHandle>,
    browser_id: String,
) -> Result<String, String> {
    let ops: &dyn BrowserOps = &SystemOps;
    with_store(&state, |store| {
        service::open_store_listing(ops, store, &browser_id, now_ms())
    })?
    .map_err(String::from)
}

/// Open the browser's own extensions page, deep-linked to our item.
#[tauri::command]
pub fn extension_setup_open_extensions_page(browser_id: String) -> Result<String, String> {
    service::open_extensions_page(&SystemOps, &browser_id).map_err(String::from)
}

/// "Skip for now" for one browser.
#[tauri::command]
pub fn extension_setup_skip(
    state: State<'_, ActivationStoreHandle>,
    browser_id: String,
) -> Result<bool, String> {
    with_store(&state, |store| {
        service::skip_browser(store, &browser_id, now_ms())
    })
}

/// User backed out of the guide without installing.
#[tauri::command]
pub fn extension_setup_cancel(
    state: State<'_, ActivationStoreHandle>,
    browser_id: String,
) -> Result<bool, String> {
    with_store(&state, |store| {
        service::cancel_setup(store, &browser_id, now_ms())
    })
}

/// Dismiss (or re-arm) the first-run onboarding gate.
#[tauri::command]
pub fn extension_setup_set_dismissed(
    state: State<'_, ActivationStoreHandle>,
    dismissed: bool,
) -> Result<bool, String> {
    with_store(&state, |store| store.set_onboarding_dismissed(dismissed))
}

/// Dev-lab: start one browser over from scratch.
#[tauri::command]
pub fn extension_setup_reset(
    state: State<'_, ActivationStoreHandle>,
    browser_id: String,
) -> Result<bool, String> {
    with_store(&state, |store| {
        service::reset_browser(store, &browser_id, now_ms())
    })
}
