//! Tauri command surface — translation only.
//!
//! Each command: unlock managed state → call a `service.rs` function → map the
//! typed error to a string. No decisions are made here, which is why there are
//! no tests in this file; the logic they would cover lives in `service.rs` and
//! is tested there against `MockOps`.
//!
//! Windows-only: every command needs a real browser to launch, and browser
//! detection is Win32. The module is registered from `app/handlers.rs`.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::State;

use crate::browser_detector::DetectedBrowsersState;

use super::launcher::{BrowserOps, SystemOps};
use super::service::{self, BrowserFacts, SetupGateState, SetupOverview};
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

/// How long an on-disk companion probe stays good for.
///
/// The probe walks every Chromium profile's `Extensions/<id>/<version>/` tree
/// and parses the `manifest.json` files it finds. That is real disk I/O, and it
/// cannot meaningfully change between two calls milliseconds apart — installing
/// an extension takes a human several seconds at minimum.
const DISK_SCAN_TTL: Duration = Duration::from_secs(10);

type DiskScanCache = HashMap<String, (Instant, bool)>;

static DISK_SCAN: LazyLock<Mutex<DiskScanCache>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// `scan_os_extension_installed` behind a short TTL. A poisoned lock falls
/// through to a live scan rather than panicking — worst case is the old cost.
fn extension_on_disk_cached(browser_id: &str) -> bool {
    let now = Instant::now();

    if let Ok(cache) = DISK_SCAN.lock() {
        if let Some((at, hit)) = cache.get(browser_id) {
            if now.saturating_duration_since(*at) < DISK_SCAN_TTL {
                return *hit;
            }
        }
    }

    let fresh = crate::browser_os_scan::scan_os_extension_installed(browser_id);
    if let Ok(mut cache) = DISK_SCAN.lock() {
        cache.insert(browser_id.to_string(), (now, fresh));
    }
    fresh
}

/// Drop every cached on-disk probe. Called when the user acts on the guide, so
/// "I just installed it" is never answered from a stale scan.
pub fn invalidate_disk_scan_cache() {
    if let Ok(mut cache) = DISK_SCAN.lock() {
        cache.clear();
    }
}

/// Assemble the per-browser facts the overview needs.
///
/// Takes the detector's cached list — which its own 2-second loop keeps fresh —
/// instead of calling `build_detected_browsers()`. That function opens a
/// `CreateToolhelp32Snapshot` over every process on the machine and resolves an
/// image path per PID; running it again here duplicated work the detector had
/// already done, on a command the UI could call many times a second.
fn collect_facts(detected: &DetectedBrowsersState) -> Vec<BrowserFacts> {
    let cached = detected
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();

    cached
        .into_iter()
        .map(|d| BrowserFacts {
            icon_url: crate::browser_icon::data_url_for_browser(&d.id),
            extension_on_disk: extension_on_disk_cached(&d.id),
            id: d.id,
            display_name: d.display_name,
            running: d.running,
        })
        .collect()
}

/// Everything the setup screen renders, in one round trip.
///
/// **Call this only while the setup UI is actually on screen.** It is the
/// expensive end of this module: a full join over the browser catalog plus a
/// base64 PNG per browser. For the first-run gate and the menu badge — which
/// are live for the whole session — use [`extension_setup_gate_state`].
#[tauri::command]
pub fn extension_setup_overview(
    state: State<'_, ActivationStoreHandle>,
    detected: State<'_, DetectedBrowsersState>,
) -> Result<SetupOverview, String> {
    let facts = collect_facts(&detected);
    with_store(&state, |store| {
        service::build_overview(&facts, store, &SystemOps)
    })
}

/// The cheap counterpart to [`extension_setup_overview`]: just enough to decide
/// whether the onboarding gate appears and what number the menu badge shows.
///
/// Reads the activation store and the detector's cached id list. No process
/// enumeration, no profile scan, no icons.
#[tauri::command]
pub fn extension_setup_gate_state(
    state: State<'_, ActivationStoreHandle>,
    detected: State<'_, DetectedBrowsersState>,
) -> Result<SetupGateState, String> {
    let ids: Vec<String> = detected
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|d| d.id.clone())
        .collect();

    with_store(&state, |store| service::build_gate_state(&ids, store))
}

/// Launch the given browser at the Chrome Web Store listing. Returns the URL.
#[tauri::command]
pub fn extension_setup_open_listing(
    state: State<'_, ActivationStoreHandle>,
    browser_id: String,
) -> Result<String, String> {
    // The user is about to install; the next probe must not answer from a scan
    // taken before they did.
    invalidate_disk_scan_cache();
    let ops: &dyn BrowserOps = &SystemOps;
    with_store(&state, |store| {
        service::open_store_listing(ops, store, &browser_id, now_ms())
    })?
    .map_err(String::from)
}

/// Open the browser's own extensions page, deep-linked to our item.
#[tauri::command]
pub fn extension_setup_open_extensions_page(browser_id: String) -> Result<String, String> {
    invalidate_disk_scan_cache();
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
    invalidate_disk_scan_cache();
    with_store(&state, |store| {
        service::reset_browser(store, &browser_id, now_ms())
    })
}
