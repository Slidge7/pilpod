//! Handshake verification and revocation — the rules that keep activation
//! honest over time.
//!
//! Two pure pieces, both fed by the detector/bridge and both fake-clock tested:
//!
//! * [`ActivationSnapshot`] — a cheap read-only copy of every browser's state,
//!   taken once per payload build so the merge path never holds the store lock.
//! * [`revocation_candidates`] — decides when a verified browser has genuinely
//!   lost its extension, as opposed to merely being closed or restarting.
//!
//! # The revocation rule, and why it is conservative
//!
//! "No extension traffic" has three very different causes:
//!
//! | Situation | Should revoke? |
//! |---|---|
//! | Browser is closed | **No** — we know nothing about its extensions |
//! | Browser just launched / resuming from sleep | **No** — traffic hasn't started yet |
//! | Browser running and silent for a long time | **Yes** — removed or disabled |
//!
//! So revocation requires the browser to be **running** *and* silent past a
//! grace window. A false revocation is expensive (it locks a working browser's
//! dashboard row and nags the user), while a missed one costs nothing — the
//! next real handshake re-activates anyway.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use super::activation::ActivationState;

/// Read-only copy of activation state, keyed by OS browser id.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ActivationSnapshot(HashMap<String, ActivationState>);

impl ActivationSnapshot {
    pub fn new(states: HashMap<String, ActivationState>) -> Self {
        Self(states)
    }

    /// State for one browser; unknown ⇒ `Inactive`.
    pub fn state_of(&self, os_browser_id: &str) -> ActivationState {
        self.0.get(os_browser_id).copied().unwrap_or_default()
    }

    pub fn is_active(&self, os_browser_id: &str) -> bool {
        self.state_of(os_browser_id).is_active()
    }

    /// Every browser currently `Active`. Order is unspecified (HashMap).
    pub fn active_ids(&self) -> impl Iterator<Item = &str> {
        self.0
            .iter()
            .filter(|(_, s)| s.is_active())
            .map(|(id, _)| id.as_str())
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl FromIterator<(String, ActivationState)> for ActivationSnapshot {
    fn from_iter<T: IntoIterator<Item = (String, ActivationState)>>(iter: T) -> Self {
        Self(iter.into_iter().collect())
    }
}

/// How long a running browser may go without extension traffic before its
/// activation is revoked. Comfortably longer than a browser cold start.
pub const REVOKE_GRACE_SECS: u64 = 120;

/// Decide which `Active` browsers should be revoked, updating the caller's
/// silence memory in place.
///
/// * `running` — browsers whose process is alive right now.
/// * `connected` — browsers with a live extension slot right now.
/// * `silent_since` — detector-owned memory of when each browser went quiet.
///   Entries are cleared as soon as a browser reconnects or closes, so a
///   browser must be *continuously* running-and-silent to be revoked.
///
/// Returns the ids to revoke, sorted, so the caller's logging and any
/// downstream emit are deterministic.
pub fn revocation_candidates(
    snapshot: &ActivationSnapshot,
    running: &HashSet<String>,
    connected: &HashSet<String>,
    silent_since: &mut HashMap<String, Instant>,
    now: Instant,
    grace: Duration,
) -> Vec<String> {
    let mut revoke = Vec::new();

    for id in snapshot.active_ids() {
        if connected.contains(id) {
            silent_since.remove(id); // healthy — reset the timer
            continue;
        }
        if !running.contains(id) {
            // A closed browser tells us nothing about its extensions. Forget the
            // timer so a long shutdown doesn't count toward the grace window.
            silent_since.remove(id);
            continue;
        }

        match silent_since.get(id) {
            Some(since) if now.saturating_duration_since(*since) >= grace => {
                revoke.push(id.to_string());
            }
            Some(_) => {}
            None => {
                silent_since.insert(id.to_string(), now);
            }
        }
    }

    // Stop tracking browsers that are no longer active at all.
    silent_since.retain(|id, _| snapshot.is_active(id));
    for id in &revoke {
        silent_since.remove(id);
    }

    revoke.sort();
    revoke
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(pairs: &[(&str, ActivationState)]) -> ActivationSnapshot {
        pairs
            .iter()
            .map(|(id, s)| (id.to_string(), *s))
            .collect()
    }

    fn ids(v: &[&str]) -> HashSet<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn active(ids_: &[&str]) -> ActivationSnapshot {
        ids_.iter()
            .map(|id| (id.to_string(), ActivationState::Active))
            .collect()
    }

    const GRACE: Duration = Duration::from_secs(120);

    // ── ActivationSnapshot ──────────────────────────────────────────────────

    #[test]
    fn snapshot_defaults_unknown_browsers_to_inactive() {
        let s = snapshot(&[("chrome", ActivationState::Active)]);
        assert_eq!(s.state_of("chrome"), ActivationState::Active);
        assert_eq!(s.state_of("brave"), ActivationState::Inactive);
        assert!(s.is_active("chrome"));
        assert!(!s.is_active("brave"));
    }

    #[test]
    fn snapshot_lists_only_active_browsers() {
        let s = snapshot(&[
            ("chrome", ActivationState::Active),
            ("brave", ActivationState::Active),
            ("msedge", ActivationState::Revoked),
            ("opera", ActivationState::SetupPending),
        ]);
        let mut got: Vec<&str> = s.active_ids().collect();
        got.sort();
        assert_eq!(got, ["brave", "chrome"]);
    }

    #[test]
    fn empty_snapshot_is_all_inactive() {
        let s = ActivationSnapshot::default();
        assert!(s.is_empty());
        assert_eq!(s.state_of("chrome"), ActivationState::Inactive);
        assert_eq!(s.active_ids().count(), 0);
    }

    // ── revocation ──────────────────────────────────────────────────────────

    #[test]
    fn connected_browser_is_never_revoked() {
        let mut silent = HashMap::new();
        let now = Instant::now();
        let out = revocation_candidates(
            &active(&["chrome"]),
            &ids(&["chrome"]),
            &ids(&["chrome"]),
            &mut silent,
            now,
            GRACE,
        );
        assert!(out.is_empty());
        assert!(silent.is_empty(), "healthy browsers carry no silence timer");
    }

    #[test]
    fn closed_browser_is_never_revoked_however_long_it_is_silent() {
        let mut silent = HashMap::new();
        let start = Instant::now();

        // Running and silent — the clock starts.
        revocation_candidates(
            &active(&["chrome"]),
            &ids(&["chrome"]),
            &ids(&[]),
            &mut silent,
            start,
            GRACE,
        );
        assert!(silent.contains_key("chrome"));

        // User quits Chrome. Silence is now uninformative, so the clock resets.
        let out = revocation_candidates(
            &active(&["chrome"]),
            &ids(&[]),
            &ids(&[]),
            &mut silent,
            start + Duration::from_secs(10_000),
            GRACE,
        );
        assert!(out.is_empty());
        assert!(!silent.contains_key("chrome"));
    }

    #[test]
    fn running_and_silent_revokes_only_after_the_grace_window() {
        let mut silent = HashMap::new();
        let start = Instant::now();
        let snap = active(&["chrome"]);
        let running = ids(&["chrome"]);
        let none = ids(&[]);

        // t=0 — first silent tick just arms the timer.
        assert!(revocation_candidates(&snap, &running, &none, &mut silent, start, GRACE).is_empty());

        // Just inside the window — still nothing.
        let almost = start + GRACE - Duration::from_secs(1);
        assert!(
            revocation_candidates(&snap, &running, &none, &mut silent, almost, GRACE).is_empty()
        );

        // At the window — revoke.
        let out =
            revocation_candidates(&snap, &running, &none, &mut silent, start + GRACE, GRACE);
        assert_eq!(out, ["chrome"]);
    }

    #[test]
    fn reconnecting_within_the_window_cancels_revocation() {
        let mut silent = HashMap::new();
        let start = Instant::now();
        let snap = active(&["chrome"]);
        let running = ids(&["chrome"]);

        revocation_candidates(&snap, &running, &ids(&[]), &mut silent, start, GRACE);

        // Browser reconnects at t+60 (e.g. finished a slow startup).
        let mid = start + Duration::from_secs(60);
        revocation_candidates(&snap, &running, &ids(&["chrome"]), &mut silent, mid, GRACE);
        assert!(silent.is_empty(), "timer must reset on reconnect");

        // t+130 is >120 s from the *original* silence but only 70 s from the
        // reconnect — must not revoke.
        let later = start + Duration::from_secs(130);
        assert!(
            revocation_candidates(&snap, &running, &ids(&[]), &mut silent, later, GRACE).is_empty()
        );
    }

    #[test]
    fn sleep_resume_does_not_revoke() {
        // Sleep looks like: browser still "running", no traffic, then a large
        // jump in wall clock. The browser reconnects on the first tick after
        // resume, which clears the timer before it can expire.
        let mut silent = HashMap::new();
        let start = Instant::now();
        let snap = active(&["chrome"]);
        let running = ids(&["chrome"]);

        revocation_candidates(&snap, &running, &ids(&[]), &mut silent, start, GRACE);

        let resumed = start + Duration::from_secs(8 * 3600);
        let out = revocation_candidates(
            &snap,
            &running,
            &ids(&["chrome"]), // reconnected on resume
            &mut silent,
            resumed,
            GRACE,
        );
        assert!(out.is_empty());
    }

    #[test]
    fn only_active_browsers_are_candidates() {
        let mut silent = HashMap::new();
        let start = Instant::now();
        let snap = snapshot(&[
            ("chrome", ActivationState::Inactive),
            ("brave", ActivationState::SetupPending),
            ("msedge", ActivationState::Revoked),
            ("opera", ActivationState::Skipped),
        ]);
        let running = ids(&["chrome", "brave", "msedge", "opera"]);

        for t in [0, 200, 5_000] {
            let out = revocation_candidates(
                &snap,
                &running,
                &ids(&[]),
                &mut silent,
                start + Duration::from_secs(t),
                GRACE,
            );
            assert!(out.is_empty(), "at t={t}");
        }
        assert!(silent.is_empty());
    }

    #[test]
    fn revokes_each_browser_independently() {
        let mut silent = HashMap::new();
        let start = Instant::now();
        let snap = active(&["chrome", "brave", "msedge"]);
        let running = ids(&["chrome", "brave", "msedge"]);

        // Chrome and Edge go quiet; Brave stays connected.
        revocation_candidates(&snap, &running, &ids(&["brave"]), &mut silent, start, GRACE);
        let out = revocation_candidates(
            &snap,
            &running,
            &ids(&["brave"]),
            &mut silent,
            start + GRACE,
            GRACE,
        );
        assert_eq!(out, ["chrome", "msedge"], "sorted and Brave untouched");
    }

    #[test]
    fn a_revoked_browser_is_not_reported_twice() {
        let mut silent = HashMap::new();
        let start = Instant::now();
        let snap = active(&["chrome"]);
        let running = ids(&["chrome"]);
        let none = ids(&[]);

        revocation_candidates(&snap, &running, &none, &mut silent, start, GRACE);
        assert_eq!(
            revocation_candidates(&snap, &running, &none, &mut silent, start + GRACE, GRACE),
            ["chrome"]
        );

        // The caller applies the revocation; on the next tick the snapshot would
        // no longer list it as Active. But even if the caller is slow, the timer
        // was cleared, so we re-arm rather than spamming.
        assert!(
            revocation_candidates(&snap, &running, &none, &mut silent, start + GRACE, GRACE)
                .is_empty()
        );
    }

    #[test]
    fn silence_memory_does_not_grow_without_bound() {
        let mut silent = HashMap::new();
        let start = Instant::now();

        // chrome is active and silent — tracked.
        revocation_candidates(
            &active(&["chrome"]),
            &ids(&["chrome"]),
            &ids(&[]),
            &mut silent,
            start,
            GRACE,
        );
        assert_eq!(silent.len(), 1);

        // chrome gets reset to Inactive by the user; the entry must be dropped.
        revocation_candidates(
            &snapshot(&[("chrome", ActivationState::Inactive)]),
            &ids(&["chrome"]),
            &ids(&[]),
            &mut silent,
            start + Duration::from_secs(1),
            GRACE,
        );
        assert!(silent.is_empty());
    }
}
