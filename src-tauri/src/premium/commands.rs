//! Tauri commands for premium status/activation. Registered on ALL platforms.

use super::{emit_status, evaluate_token, license, store, Entitlement, EntitlementState, PremiumStatus};
use tauri::State;

#[tauri::command]
pub fn premium_get_status(state: State<'_, EntitlementState>) -> PremiumStatus {
    state
        .read()
        .map(|e| e.status())
        .unwrap_or_else(|_| Entitlement::free(Some("state_poisoned".into())).status())
}

/// Activate with a license key (PP1 token). Verifies signature + expiry
/// (no grace window at activation time), persists, updates state, emits event.
#[tauri::command]
pub fn premium_activate(
    app: tauri::AppHandle,
    state: State<'_, EntitlementState>,
    key: String,
) -> Result<PremiumStatus, String> {
    let token = key.trim();
    let payload = license::parse_and_verify(token, &license::LICENSE_PUBKEY)?;
    if license::is_expired(&payload, license::now_unix(), 0) {
        return Err("expired".into());
    }

    store::save(&app, token)?;

    let ent = evaluate_token(token, license::now_unix());
    {
        let mut guard = state.write().map_err(|_| "state_poisoned".to_string())?;
        *guard = ent.clone();
    }
    emit_status(&app, &ent);
    Ok(ent.status())
}

/// Remove the stored license and revert to Free tier.
#[tauri::command]
pub fn premium_deactivate(
    app: tauri::AppHandle,
    state: State<'_, EntitlementState>,
) -> Result<PremiumStatus, String> {
    store::delete(&app)?;
    let ent = Entitlement::free(None);
    {
        let mut guard = state.write().map_err(|_| "state_poisoned".to_string())?;
        *guard = ent.clone();
    }
    emit_status(&app, &ent);
    Ok(ent.status())
}
