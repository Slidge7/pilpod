//! Premium entitlement — single source of truth for feature gating.
//!
//! Platform-neutral (no `cfg(windows)`). The Rust side is authoritative:
//! UI gating is cosmetic; every premium command must call [`require_premium`]
//! as its first statement.
//!
//! Event: `premium://status` (PremiumStatus payload) — emitted at startup and
//! on every entitlement change.

pub mod commands;
pub mod license;
pub mod store;

use std::sync::{Arc, RwLock};
use tauri::Emitter;

pub const STATUS_EVENT: &str = "premium://status";
pub const ERR_PREMIUM_REQUIRED: &str = "premium_required";

/// In-memory entitlement snapshot derived from a verified license token.
#[derive(Debug, Clone, Default)]
pub struct Entitlement {
    pub active: bool,
    pub plan: String,
    pub features: Vec<String>,
    pub email: Option<String>,
    pub expires_at: Option<u64>,
    /// Why the entitlement is inactive (e.g. "invalid_signature", "expired").
    pub reason: Option<String>,
}

impl Entitlement {
    pub fn free(reason: Option<String>) -> Self {
        Self {
            active: false,
            plan: "free".into(),
            reason,
            ..Default::default()
        }
    }

    pub fn status(&self) -> PremiumStatus {
        PremiumStatus {
            active: self.active,
            plan: self.plan.clone(),
            features: self.features.clone(),
            email: self.email.clone(),
            expires_at: self.expires_at,
            reason: self.reason.clone(),
        }
    }
}

/// Frontend-facing status payload (camelCase).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PremiumStatus {
    pub active: bool,
    pub plan: String,
    pub features: Vec<String>,
    pub email: Option<String>,
    pub expires_at: Option<u64>,
    pub reason: Option<String>,
}

pub type EntitlementState = Arc<RwLock<Entitlement>>;

/// Evaluate a raw token into an entitlement. Startup path applies the grace
/// window so a license that lapsed while offline degrades gently.
pub fn evaluate_token(token: &str, now: u64) -> Entitlement {
    match license::parse_and_verify(token, &license::LICENSE_PUBKEY) {
        Ok(payload) => {
            if license::is_expired(&payload, now, license::GRACE_SECS) {
                Entitlement::free(Some("expired".into()))
            } else {
                Entitlement {
                    active: true,
                    plan: payload.plan,
                    features: payload.features,
                    email: Some(payload.email),
                    expires_at: payload.expires_at,
                    reason: None,
                }
            }
        }
        Err(e) => Entitlement::free(Some(e)),
    }
}

/// The gate. First line of every premium command (all `dl_*` commands in
/// Phase 2+). Re-checks expiry against the wall clock on every call so a
/// license lapsing mid-session blocks new operations without a restart.
pub fn require_premium(state: &EntitlementState, feature: &str) -> Result<(), String> {
    let ent = state
        .read()
        .map_err(|_| ERR_PREMIUM_REQUIRED.to_string())?;
    let now = license::now_unix();
    let expired = ent
        .expires_at
        .map(|exp| now > exp.saturating_add(license::GRACE_SECS))
        .unwrap_or(false);
    if ent.active && !expired && ent.features.iter().any(|f| f == feature) {
        Ok(())
    } else {
        Err(ERR_PREMIUM_REQUIRED.to_string())
    }
}

pub fn emit_status(handle: &tauri::AppHandle, ent: &Entitlement) {
    if let Err(e) = handle.emit(STATUS_EVENT, ent.status()) {
        log::warn!("[premium] emit status failed: {e}");
    }
}

/// Startup init: load stored token (if any), evaluate, register managed state,
/// emit the initial status event. Never fails the app: any problem ⇒ Free tier.
pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    let handle = app.handle().clone();
    let ent = match store::load(&handle) {
        Some(token) => evaluate_token(&token, license::now_unix()),
        None => Entitlement::free(None),
    };
    log::info!(
        "[premium] init: active={} plan={} reason={:?}",
        ent.active,
        ent.plan,
        ent.reason
    );
    emit_status(&handle, &ent);
    let state: EntitlementState = Arc::new(RwLock::new(ent));
    app.manage(state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entitled(features: Vec<&str>, expires_at: Option<u64>) -> EntitlementState {
        Arc::new(RwLock::new(Entitlement {
            active: true,
            plan: "premium".into(),
            features: features.into_iter().map(String::from).collect(),
            email: Some("t@e.com".into()),
            expires_at,
            reason: None,
        }))
    }

    #[test]
    fn require_premium_passes_for_entitled_feature() {
        let state = entitled(vec!["downloader"], None);
        assert!(require_premium(&state, "downloader").is_ok());
    }

    #[test]
    fn require_premium_blocks_free_tier() {
        let state: EntitlementState = Arc::new(RwLock::new(Entitlement::free(None)));
        assert_eq!(
            require_premium(&state, "downloader").unwrap_err(),
            ERR_PREMIUM_REQUIRED
        );
    }

    #[test]
    fn require_premium_blocks_missing_feature() {
        let state = entitled(vec!["some_other_feature"], None);
        assert!(require_premium(&state, "downloader").is_err());
    }

    #[test]
    fn require_premium_blocks_mid_session_expiry() {
        // Active flag still true, but expires_at (+grace) is in the past.
        let state = entitled(vec!["downloader"], Some(1));
        assert_eq!(
            require_premium(&state, "downloader").unwrap_err(),
            ERR_PREMIUM_REQUIRED
        );
    }

    #[test]
    fn evaluate_token_garbage_falls_back_to_free() {
        let ent = evaluate_token("not a token", 0);
        assert!(!ent.active);
        assert_eq!(ent.plan, "free");
        assert!(ent.reason.is_some());
    }
}
