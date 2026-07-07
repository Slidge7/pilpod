//! License token parsing + Ed25519 signature verification.
//!
//! Token format (version PP1):
//!   "PP1." + base64url_nopad(payload_json) + "." + base64url_nopad(ed25519_sig)
//!
//! The signature is computed over the exact payload JSON bytes. Verification is
//! fully offline against the public key compiled into the binary.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// Public half of the license signing keypair.
/// DEV KEY — replace with the production public key before release
/// (generate via `cargo run --bin license_tool -- keygen`).
pub const LICENSE_PUBKEY: [u8; 32] = [
    21, 44, 53, 42, 255, 155, 126, 242, 164, 229, 74, 74, 193, 5, 130, 114, 107, 51, 125, 123,
    246, 252, 59, 12, 66, 93, 228, 93, 145, 86, 229, 117,
];

/// Clock-skew / renewal grace window applied after `expires_at`.
pub const GRACE_SECS: u64 = 72 * 3600;

pub const TOKEN_PREFIX: &str = "PP1.";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LicensePayload {
    pub email: String,
    pub plan: String,
    pub features: Vec<String>,
    pub issued_at: u64,
    /// Unix seconds; `None` = lifetime license.
    pub expires_at: Option<u64>,
}

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Signature + format check only. Expiry is evaluated separately so callers
/// can apply (or skip) the grace window.
pub fn parse_and_verify(token: &str, pubkey: &[u8; 32]) -> Result<LicensePayload, String> {
    let token = token.trim();
    let rest = token
        .strip_prefix(TOKEN_PREFIX)
        .ok_or_else(|| "invalid_format: missing PP1 prefix".to_string())?;
    let (payload_b64, sig_b64) = rest
        .split_once('.')
        .ok_or_else(|| "invalid_format: missing signature section".to_string())?;

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|_| "invalid_format: payload not base64url".to_string())?;
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(sig_b64)
        .map_err(|_| "invalid_format: signature not base64url".to_string())?;

    let sig_arr: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "invalid_format: signature length".to_string())?;
    let signature = Signature::from_bytes(&sig_arr);

    let verifying_key =
        VerifyingKey::from_bytes(pubkey).map_err(|_| "invalid_key: bad public key".to_string())?;

    verifying_key
        .verify(&payload_bytes, &signature)
        .map_err(|_| "invalid_signature".to_string())?;

    serde_json::from_slice::<LicensePayload>(&payload_bytes)
        .map_err(|e| format!("invalid_payload: {e}"))
}

/// True once `expires_at + grace` is in the past. Lifetime licenses never expire.
pub fn is_expired(payload: &LicensePayload, now: u64, grace: u64) -> bool {
    match payload.expires_at {
        Some(exp) => now > exp.saturating_add(grace),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// Any 32 bytes are a valid Ed25519 seed — fixed keys keep tests deterministic.
    fn test_keypair(seed_byte: u8) -> (SigningKey, [u8; 32]) {
        let signing = SigningKey::from_bytes(&[seed_byte; 32]);
        let pubkey = signing.verifying_key().to_bytes();
        (signing, pubkey)
    }

    fn make_token(signing: &SigningKey, payload_json: &str) -> String {
        let sig = signing.sign(payload_json.as_bytes());
        format!(
            "{}{}.{}",
            TOKEN_PREFIX,
            URL_SAFE_NO_PAD.encode(payload_json),
            URL_SAFE_NO_PAD.encode(sig.to_bytes())
        )
    }

    fn payload_json(expires_at: Option<u64>) -> String {
        serde_json::to_string(&LicensePayload {
            email: "test@example.com".into(),
            plan: "premium".into(),
            features: vec!["downloader".into()],
            issued_at: 1_700_000_000,
            expires_at,
        })
        .unwrap()
    }

    #[test]
    fn valid_license_verifies() {
        let (signing, pubkey) = test_keypair(7);
        let token = make_token(&signing, &payload_json(None));
        let p = parse_and_verify(&token, &pubkey).expect("should verify");
        assert_eq!(p.email, "test@example.com");
        assert!(p.features.contains(&"downloader".to_string()));
    }

    #[test]
    fn tampered_payload_rejected() {
        let (signing, pubkey) = test_keypair(7);
        let token = make_token(&signing, &payload_json(None));
        // Swap the payload for an upgraded one, keep the original signature.
        let forged_payload = payload_json(None).replace("premium", "ultimate");
        let sig_part = token.rsplit('.').next().unwrap();
        let forged = format!(
            "{}{}.{}",
            TOKEN_PREFIX,
            URL_SAFE_NO_PAD.encode(&forged_payload),
            sig_part
        );
        assert_eq!(
            parse_and_verify(&forged, &pubkey).unwrap_err(),
            "invalid_signature"
        );
    }

    #[test]
    fn wrong_key_rejected() {
        let (signing, _) = test_keypair(7);
        let (_, other_pubkey) = test_keypair(9);
        let token = make_token(&signing, &payload_json(None));
        assert_eq!(
            parse_and_verify(&token, &other_pubkey).unwrap_err(),
            "invalid_signature"
        );
    }

    #[test]
    fn garbage_tokens_rejected_without_panic() {
        let (_, pubkey) = test_keypair(7);
        for bad in [
            "",
            "PP1.",
            "PP1..",
            "hello world",
            "PP1.not-base64!!!.also-not",
            "PP2.eyJ9.c2ln",
            &"PP1.".repeat(500),
        ] {
            assert!(parse_and_verify(bad, &pubkey).is_err());
        }
    }

    #[test]
    fn expired_license_detected() {
        let now = 2_000_000_000u64;
        let p: LicensePayload =
            serde_json::from_str(&payload_json(Some(now - GRACE_SECS - 1))).unwrap();
        assert!(is_expired(&p, now, GRACE_SECS));
    }

    #[test]
    fn grace_window_honored() {
        let now = 2_000_000_000u64;
        // Expired 1h ago — still inside the 72h grace window.
        let p: LicensePayload = serde_json::from_str(&payload_json(Some(now - 3600))).unwrap();
        assert!(!is_expired(&p, now, GRACE_SECS));
        // Exactly at the grace boundary — still valid.
        let p2: LicensePayload =
            serde_json::from_str(&payload_json(Some(now - GRACE_SECS))).unwrap();
        assert!(!is_expired(&p2, now, GRACE_SECS));
    }

    #[test]
    fn lifetime_license_never_expires() {
        let p: LicensePayload = serde_json::from_str(&payload_json(None)).unwrap();
        assert!(!is_expired(&p, u64::MAX, GRACE_SECS));
    }
}
