//! Per-browser activation state machine — pure, total, no I/O.
//!
//! Replaces the single `extension_installed: bool` with a state that can express
//! the four situations the UI actually needs to distinguish:
//!
//! * never set up (`Inactive`)
//! * user is mid-setup, we're waiting for the handshake (`SetupPending`)
//! * verified working (`Active`)
//! * was working, extension has since vanished (`Revoked`)
//! * user deliberately declined (`Skipped`) — locked, but never re-prompted
//!
//! **The only way into `Active` is [`ActivationEvent::HandshakeVerified`]**, which
//! the bridge emits after peer-PID attribution proves which browser connected.
//! Nothing self-reported can activate a browser.
//!
//! [`advance`] is total: every (state, event) pair returns a state, illegal
//! combinations are no-ops rather than errors. Callers persist the result only
//! when it differs from the input, so a no-op costs no disk write.

use serde::{Deserialize, Serialize};

/// Activation state for one OS browser (keyed by catalog id: `"chrome"`, `"msedge"`…).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivationState {
    /// Detected on the machine; extension never verified.
    #[default]
    Inactive,
    /// User opened the setup guide for this browser; awaiting handshake.
    SetupPending,
    /// Extension verified via the bridge handshake.
    Active,
    /// Was `Active`; extension unseen past the grace window (removed/disabled).
    Revoked,
    /// User chose "Skip for now". Locked like `Inactive`, but not re-prompted.
    Skipped,
}

impl ActivationState {
    /// True when the browser's features may be used. The dashboard gates on this.
    pub fn is_active(self) -> bool {
        matches!(self, ActivationState::Active)
    }

    /// True when the user should be nudged. `Skipped` is deliberately excluded —
    /// declining once must not produce a prompt on every launch.
    pub fn needs_attention(self) -> bool {
        matches!(self, ActivationState::Inactive | ActivationState::Revoked)
    }
}

/// Things that happen to a browser's activation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivationEvent {
    /// User opened the setup guide / we launched the store listing for them.
    SetupStarted,
    /// Bridge attributed a connection to this browser via peer PID. Ground truth.
    HandshakeVerified,
    /// No slot/heartbeat for this browser. `grace_expired` is false while the
    /// browser may simply be restarting or resuming from sleep.
    ExtensionLost { grace_expired: bool },
    /// User backed out of the guide without installing.
    SetupCancelled,
    /// User pressed "Skip for now".
    SkipRequested,
    /// Dev-lab / "start over": forget everything about this browser.
    Reset,
}

/// Total transition function. Unknown combinations return `state` unchanged.
///
/// Design rules encoded here:
/// 1. `HandshakeVerified` always wins — reality beats bookkeeping.
/// 2. `SetupStarted` never *downgrades* an `Active` browser (re-reading the
///    guide on a working browser must not lock its dashboard row).
/// 3. Only `Active` can become `Revoked`, and only once the grace window expires.
pub fn advance(state: ActivationState, event: ActivationEvent) -> ActivationState {
    use ActivationEvent as E;
    use ActivationState as S;

    match (state, event) {
        // Reality beats bookkeeping: verification activates from anywhere.
        (_, E::HandshakeVerified) => S::Active,

        // Reset returns to the pristine state from anywhere.
        (_, E::Reset) => S::Inactive,

        // Entering setup — but never demote a working browser (rule 2).
        (S::Active, E::SetupStarted) => S::Active,
        (_, E::SetupStarted) => S::SetupPending,

        // Skipping — likewise never demotes a working browser.
        (S::Active, E::SkipRequested) => S::Active,
        (_, E::SkipRequested) => S::Skipped,

        // Backing out of the guide only affects an in-progress setup.
        (S::SetupPending, E::SetupCancelled) => S::Inactive,
        (other, E::SetupCancelled) => other,

        // Revocation applies to verified browsers only, after the grace window.
        (S::Active, E::ExtensionLost { grace_expired: true }) => S::Revoked,
        (other, E::ExtensionLost { .. }) => other,
    }
}

#[cfg(test)]
mod tests {
    use super::ActivationEvent as E;
    use super::ActivationState as S;
    use super::*;

    const ALL_STATES: [S; 5] = [
        S::Inactive,
        S::SetupPending,
        S::Active,
        S::Revoked,
        S::Skipped,
    ];

    const ALL_EVENTS: [E; 7] = [
        E::SetupStarted,
        E::HandshakeVerified,
        E::ExtensionLost { grace_expired: true },
        E::ExtensionLost { grace_expired: false },
        E::SetupCancelled,
        E::SkipRequested,
        E::Reset,
    ];

    /// The full transition table, spelled out. If a transition changes, this test
    /// is the thing that must be edited deliberately.
    #[test]
    fn transition_table_is_exact() {
        let expected: &[(S, E, S)] = &[
            // ── from Inactive ───────────────────────────────────────────────
            (S::Inactive, E::SetupStarted, S::SetupPending),
            (S::Inactive, E::HandshakeVerified, S::Active),
            (S::Inactive, E::SetupCancelled, S::Inactive),
            (S::Inactive, E::SkipRequested, S::Skipped),
            (S::Inactive, E::Reset, S::Inactive),
            (S::Inactive, E::ExtensionLost { grace_expired: true }, S::Inactive),
            // ── from SetupPending ───────────────────────────────────────────
            (S::SetupPending, E::SetupStarted, S::SetupPending), // idempotent
            (S::SetupPending, E::HandshakeVerified, S::Active),
            (S::SetupPending, E::SetupCancelled, S::Inactive),
            (S::SetupPending, E::SkipRequested, S::Skipped),
            (S::SetupPending, E::Reset, S::Inactive),
            (S::SetupPending, E::ExtensionLost { grace_expired: true }, S::SetupPending),
            // ── from Active ─────────────────────────────────────────────────
            (S::Active, E::SetupStarted, S::Active), // no downgrade
            (S::Active, E::HandshakeVerified, S::Active),
            (S::Active, E::SetupCancelled, S::Active),
            (S::Active, E::SkipRequested, S::Active), // no downgrade
            (S::Active, E::Reset, S::Inactive),
            (S::Active, E::ExtensionLost { grace_expired: false }, S::Active),
            (S::Active, E::ExtensionLost { grace_expired: true }, S::Revoked),
            // ── from Revoked ────────────────────────────────────────────────
            (S::Revoked, E::SetupStarted, S::SetupPending),
            (S::Revoked, E::HandshakeVerified, S::Active), // reconnect heals
            (S::Revoked, E::SetupCancelled, S::Revoked),
            (S::Revoked, E::SkipRequested, S::Skipped),
            (S::Revoked, E::Reset, S::Inactive),
            (S::Revoked, E::ExtensionLost { grace_expired: true }, S::Revoked),
            // ── from Skipped ────────────────────────────────────────────────
            (S::Skipped, E::SetupStarted, S::SetupPending), // changed their mind
            (S::Skipped, E::HandshakeVerified, S::Active),
            (S::Skipped, E::SetupCancelled, S::Skipped),
            (S::Skipped, E::SkipRequested, S::Skipped),
            (S::Skipped, E::Reset, S::Inactive),
            (S::Skipped, E::ExtensionLost { grace_expired: true }, S::Skipped),
        ];

        for &(from, event, want) in expected {
            assert_eq!(
                advance(from, event),
                want,
                "advance({from:?}, {event:?}) should be {want:?}"
            );
        }
    }

    #[test]
    fn advance_is_total_and_never_panics() {
        for state in ALL_STATES {
            for event in ALL_EVENTS {
                let _ = advance(state, event);
            }
        }
    }

    #[test]
    fn only_handshake_can_produce_active() {
        for state in ALL_STATES.iter().copied().filter(|s| *s != S::Active) {
            for event in ALL_EVENTS.iter().copied().filter(|e| *e != E::HandshakeVerified) {
                assert_ne!(
                    advance(state, event),
                    S::Active,
                    "{state:?} + {event:?} must not activate without a verified handshake"
                );
            }
        }
    }

    #[test]
    fn nothing_but_active_can_enter_revoked() {
        // `Revoked` staying `Revoked` is not *entering* it, so it is excluded.
        let cannot_enter = ALL_STATES
            .iter()
            .copied()
            .filter(|s| *s != S::Active && *s != S::Revoked);
        for state in cannot_enter {
            for event in ALL_EVENTS {
                assert_ne!(
                    advance(state, event),
                    S::Revoked,
                    "{state:?} + {event:?} — only a verified browser can be revoked"
                );
            }
        }
    }

    #[test]
    fn grace_window_prevents_revocation() {
        assert_eq!(
            advance(S::Active, E::ExtensionLost { grace_expired: false }),
            S::Active,
            "a browser restarting or resuming from sleep must stay Active"
        );
    }

    #[test]
    fn reset_reaches_inactive_from_everywhere() {
        for state in ALL_STATES {
            assert_eq!(advance(state, E::Reset), S::Inactive);
        }
    }

    #[test]
    fn predicates_match_intent() {
        assert!(S::Active.is_active());
        for s in ALL_STATES.iter().copied().filter(|s| *s != S::Active) {
            assert!(!s.is_active(), "{s:?}");
        }
        assert!(S::Inactive.needs_attention());
        assert!(S::Revoked.needs_attention());
        // Skipped must never re-prompt — that is the whole point of the state.
        assert!(!S::Skipped.needs_attention());
        assert!(!S::Active.needs_attention());
        assert!(!S::SetupPending.needs_attention());
    }

    #[test]
    fn serializes_as_camel_case_for_the_frontend() {
        let json = serde_json::to_string(&S::SetupPending).unwrap();
        assert_eq!(json, "\"setupPending\"");
        assert_eq!(serde_json::to_string(&S::Inactive).unwrap(), "\"inactive\"");
        let back: S = serde_json::from_str("\"revoked\"").unwrap();
        assert_eq!(back, S::Revoked);
    }

    #[test]
    fn default_is_inactive() {
        assert_eq!(S::default(), S::Inactive);
    }
}
