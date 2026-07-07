//! Dev Lab full-state assembly — pure, unit-tested logic.
//!
//! One struct that captures everything the Dev Lab shows: the OS scan rows,
//! one diagnostic row per extension slot (the raw truth, pre-merge), and the
//! merged payload exactly as the dashboard receives it — so mismatches between
//! "truth" and "what the user sees" are visible side by side.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::browser_detector::browser_name_to_id;
use crate::browser_dto::BrowsersUpdatePayload;
use crate::browser_os_scan::DevOsBrowserScanRow;
use crate::browser_tabs::BrowserSlot;

/// Diagnostic view of one extension slot (per-profile), pre-merge.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevSlotRow {
    /// Extension profile UUID.
    pub browser_id: String,
    /// Raw name the extension self-reported (UA sniff — unreliable for forks).
    pub reported_name: String,
    /// Effective catalog id: PID-verified when available, else self-report mapping.
    pub os_browser_id: String,
    /// How the binding was established: `"pidVerified"` or `"selfReport"`.
    pub binding: String,
    /// Catalog id the self-reported name maps to (for conflict display).
    pub self_report_os_id: String,
    /// True when PID-verified id and self-report mapping disagree (e.g. Brave says "Chrome").
    pub binding_conflict: bool,
    /// Live WebSocket session right now.
    pub ws_connected: bool,
    /// Heartbeat within the freshness window (HTTP fallback path).
    pub heartbeat_fresh: bool,
    /// Seconds since the last message from this slot.
    pub last_seen_secs: u64,
    /// Waiting for reconnect after a drop / system resume.
    pub reconnecting: bool,
    /// Persisted "extension has ever connected" flag for the mapped OS id.
    pub ext_installed_persisted: bool,
    pub tab_count: usize,
    pub window_count: usize,
    pub audible_count: usize,
    /// Slot content hash (diff-before-emit) as string — u64 exceeds JSON safe ints.
    pub content_hash: String,
    pub tabs: Vec<crate::browser_dto::BrowserTab>,
}

/// Everything the Dev Lab renders, assembled in one call.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevFullState {
    pub generated_at_ms: u64,
    /// OS truth: registry + process scan for every catalog browser.
    pub os_rows: Vec<DevOsBrowserScanRow>,
    /// Extension slots, raw (pre-merge).
    pub slots: Vec<DevSlotRow>,
    /// The exact merged payload the dashboard receives.
    pub merged: BrowsersUpdatePayload,
}

/// Build diagnostic slot rows. Pure: all inputs passed explicitly.
pub fn build_dev_slot_rows(
    slots: &HashMap<String, BrowserSlot>,
    ws_connected: &HashSet<String>,
    reconnecting: &HashSet<String>,
    ext_installed: &dyn Fn(&str) -> bool,
    now: Instant,
    freshness: Duration,
) -> Vec<DevSlotRow> {
    let mut rows: Vec<DevSlotRow> = slots
        .values()
        .map(|slot| {
            let self_report_os_id = browser_name_to_id(&slot.browser_name);
            let os_id = slot.effective_os_id();
            let pid_verified = slot.verified_os_id.is_some();
            let age = now.saturating_duration_since(slot.last_seen);
            let windows: HashSet<i64> = slot.tabs.iter().map(|t| t.window_id).collect();
            DevSlotRow {
                browser_id: slot.browser_id.clone(),
                reported_name: slot.browser_name.clone(),
                binding: if pid_verified { "pidVerified" } else { "selfReport" }.to_string(),
                binding_conflict: pid_verified && os_id != self_report_os_id,
                self_report_os_id,
                ws_connected: ws_connected.contains(&slot.browser_id),
                heartbeat_fresh: age < freshness,
                last_seen_secs: age.as_secs(),
                reconnecting: reconnecting.contains(&slot.browser_id),
                ext_installed_persisted: ext_installed(&os_id),
                tab_count: slot.tabs.len(),
                window_count: windows.len(),
                audible_count: slot.tabs.iter().filter(|t| t.audible).count(),
                content_hash: slot.content_hash.to_string(),
                tabs: slot.tabs.clone(),
                os_browser_id: os_id,
            }
        })
        .collect();

    // Stable ordering: by mapped OS id, then profile UUID.
    rows.sort_by(|a, b| {
        (a.os_browser_id.as_str(), a.browser_id.as_str())
            .cmp(&(b.os_browser_id.as_str(), b.browser_id.as_str()))
    });
    rows
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser_dto::BrowserTab;

    fn tab(tab_id: i64, window_id: i64, audible: bool) -> BrowserTab {
        BrowserTab {
            tab_id,
            window_id,
            audible,
            ..Default::default()
        }
    }

    fn slot(id: &str, name: &str, tabs: Vec<BrowserTab>, seen_ago: Duration) -> BrowserSlot {
        BrowserSlot {
            last_seen: Instant::now() - seen_ago,
            browser_id: id.to_string(),
            browser_name: name.to_string(),
            verified_os_id: None,
            tabs,
            content_hash: 42,
        }
    }

    fn verified_slot(id: &str, name: &str, verified: &str) -> BrowserSlot {
        BrowserSlot {
            verified_os_id: Some(verified.to_string()),
            ..slot(id, name, vec![], Duration::ZERO)
        }
    }

    fn build(
        slots: Vec<BrowserSlot>,
        ws: &[&str],
        reconnecting: &[&str],
        installed: &[&str],
    ) -> Vec<DevSlotRow> {
        let map: HashMap<String, BrowserSlot> = slots
            .into_iter()
            .map(|s| (s.browser_id.clone(), s))
            .collect();
        let ws: HashSet<String> = ws.iter().map(|s| s.to_string()).collect();
        let rec: HashSet<String> = reconnecting.iter().map(|s| s.to_string()).collect();
        let inst: HashSet<String> = installed.iter().map(|s| s.to_string()).collect();
        build_dev_slot_rows(
            &map,
            &ws,
            &rec,
            &|id| inst.contains(id),
            Instant::now(),
            Duration::from_secs(3),
        )
    }

    #[test]
    fn maps_reported_name_to_catalog_id() {
        let rows = build(
            vec![slot("uuid-1", "Edge", vec![], Duration::ZERO)],
            &[],
            &[],
            &[],
        );
        assert_eq!(rows[0].reported_name, "Edge");
        assert_eq!(rows[0].os_browser_id, "msedge");
        assert_eq!(rows[0].binding, "selfReport");
        assert!(!rows[0].binding_conflict);
    }

    #[test]
    fn pid_verified_binding_wins_over_self_report() {
        // Brave's MV3 worker self-reports as "Chrome"; the socket owner is brave.exe.
        let rows = build(
            vec![verified_slot("uuid-1", "Chrome", "brave")],
            &[],
            &[],
            &[],
        );
        assert_eq!(rows[0].os_browser_id, "brave");
        assert_eq!(rows[0].self_report_os_id, "chrome");
        assert_eq!(rows[0].binding, "pidVerified");
        assert!(rows[0].binding_conflict);
    }

    #[test]
    fn verified_binding_agreeing_with_self_report_is_no_conflict() {
        let rows = build(
            vec![verified_slot("uuid-1", "Chrome", "chrome")],
            &[],
            &[],
            &[],
        );
        assert_eq!(rows[0].os_browser_id, "chrome");
        assert_eq!(rows[0].binding, "pidVerified");
        assert!(!rows[0].binding_conflict);
    }

    #[test]
    fn installed_flag_uses_effective_id_for_verified_slot() {
        let rows = build(
            vec![verified_slot("uuid-1", "Chrome", "brave")],
            &[],
            &[],
            &["brave"], // persisted under the *verified* id
        );
        assert!(rows[0].ext_installed_persisted);
    }

    #[test]
    fn ws_beats_heartbeat_and_both_reported() {
        let rows = build(
            vec![slot("uuid-1", "Chrome", vec![], Duration::from_secs(60))],
            &["uuid-1"],
            &[],
            &[],
        );
        assert!(rows[0].ws_connected);
        assert!(!rows[0].heartbeat_fresh); // stale heartbeat, live socket
        assert_eq!(rows[0].last_seen_secs, 60);
    }

    #[test]
    fn heartbeat_fresh_within_window() {
        let rows = build(
            vec![slot("uuid-1", "Chrome", vec![], Duration::from_secs(1))],
            &[],
            &[],
            &[],
        );
        assert!(!rows[0].ws_connected);
        assert!(rows[0].heartbeat_fresh);
    }

    #[test]
    fn counts_windows_and_audible() {
        let tabs = vec![tab(1, 10, true), tab(2, 10, false), tab(3, 20, true)];
        let rows = build(
            vec![slot("uuid-1", "Chrome", tabs, Duration::ZERO)],
            &[],
            &[],
            &[],
        );
        assert_eq!(rows[0].tab_count, 3);
        assert_eq!(rows[0].window_count, 2);
        assert_eq!(rows[0].audible_count, 2);
    }

    #[test]
    fn installed_flag_keyed_by_mapped_os_id() {
        let rows = build(
            vec![slot("uuid-1", "Edge", vec![], Duration::ZERO)],
            &[],
            &[],
            &["msedge"], // persisted under the catalog id, not "Edge"
        );
        assert!(rows[0].ext_installed_persisted);
    }

    #[test]
    fn reconnecting_flag_surfaces() {
        let rows = build(
            vec![slot("uuid-1", "Firefox", vec![], Duration::from_secs(30))],
            &[],
            &["uuid-1"],
            &[],
        );
        assert!(rows[0].reconnecting);
    }

    #[test]
    fn stable_ordering_by_os_id_then_uuid() {
        let rows = build(
            vec![
                slot("uuid-b", "Chrome", vec![], Duration::ZERO),
                slot("uuid-a", "Chrome", vec![], Duration::ZERO),
                slot("uuid-z", "Brave", vec![], Duration::ZERO),
            ],
            &[],
            &[],
            &[],
        );
        let keys: Vec<(&str, &str)> = rows
            .iter()
            .map(|r| (r.os_browser_id.as_str(), r.browser_id.as_str()))
            .collect();
        assert_eq!(
            keys,
            vec![
                ("brave", "uuid-z"),
                ("chrome", "uuid-a"),
                ("chrome", "uuid-b"),
            ]
        );
    }

    #[test]
    fn content_hash_serialised_as_string() {
        let rows = build(
            vec![slot("uuid-1", "Chrome", vec![], Duration::ZERO)],
            &[],
            &[],
            &[],
        );
        assert_eq!(rows[0].content_hash, "42");
    }
}
