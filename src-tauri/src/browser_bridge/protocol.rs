//! Bridge protocol constants, capabilities DTO, and version validation.

use axum::http::StatusCode;
use serde::Serialize;

use super::{BROWSER_MEDIA_PATH, BROWSER_WS_PATH, BROWSER_WS_PORT};

pub const PROTOCOL_VERSION: &str = "1";
pub const BRIDGE_VERSION: &str = "1.2";
pub const CONNECTED_WINDOW_SECS: u64 = 3;
pub const COMMAND_TTL_SECS: u64 = 5;

pub const CAPABILITIES_PATH: &str = "/capabilities";

pub const PUSH_INTERVAL_MS: u64 = 250;
pub const DEBOUNCE_MS: u64 = 60;
pub const FETCH_TIMEOUT_MS: u64 = 800;
pub const FAIL_THRESHOLD: u32 = 4;
pub const SLEEP_INTERVAL_MS: u64 = 5000;
pub const WS_CONNECT_TIMEOUT_MS: u64 = 2000;
pub const WS_RECONNECT_MS: u64 = 3000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeCapabilities {
    pub version: &'static str,
    pub protocol_version: &'static str,
    pub max_command_ttl_ms: u64,
    pub connected_window_ms: u64,
    pub supports_web_socket: bool,
    pub push_interval_ms: u64,
    pub debounce_ms: u64,
    pub fetch_timeout_ms: u64,
    pub fail_threshold: u32,
    pub sleep_interval_ms: u64,
    pub ws_connect_timeout_ms: u64,
    pub ws_reconnect_ms: u64,
    pub http_path: &'static str,
    pub ws_url: String,
}

pub fn bridge_capabilities() -> BridgeCapabilities {
    BridgeCapabilities {
        version: BRIDGE_VERSION,
        protocol_version: PROTOCOL_VERSION,
        max_command_ttl_ms: COMMAND_TTL_SECS * 1000,
        connected_window_ms: CONNECTED_WINDOW_SECS * 1000,
        supports_web_socket: true,
        push_interval_ms: PUSH_INTERVAL_MS,
        debounce_ms: DEBOUNCE_MS,
        fetch_timeout_ms: FETCH_TIMEOUT_MS,
        fail_threshold: FAIL_THRESHOLD,
        sleep_interval_ms: SLEEP_INTERVAL_MS,
        ws_connect_timeout_ms: WS_CONNECT_TIMEOUT_MS,
        ws_reconnect_ms: WS_RECONNECT_MS,
        http_path: BROWSER_MEDIA_PATH,
        ws_url: format!("ws://127.0.0.1:{BROWSER_WS_PORT}{BROWSER_WS_PATH}"),
    }
}

/// Validate an optional protocol version string from an extension payload.
/// Missing/empty is treated as v1 for backward compatibility.
pub fn validate_protocol_version(v: Option<&str>) -> Result<(), StatusCode> {
    let raw = match v {
        None | Some("") => return Ok(()),
        Some(s) => s.trim(),
    };

    let major = raw
        .split('.')
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .ok_or(StatusCode::BAD_REQUEST)?;

    if major == 1 {
        Ok(())
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_accepts_missing_and_v1_variants() {
        assert!(validate_protocol_version(None).is_ok());
        assert!(validate_protocol_version(Some("")).is_ok());
        assert!(validate_protocol_version(Some("1")).is_ok());
        assert!(validate_protocol_version(Some("1.0")).is_ok());
        assert!(validate_protocol_version(Some("1.2")).is_ok());
    }

    #[test]
    fn validate_rejects_major_v2_and_garbage() {
        assert_eq!(
            validate_protocol_version(Some("2")),
            Err(StatusCode::BAD_REQUEST)
        );
        assert_eq!(
            validate_protocol_version(Some("2.0")),
            Err(StatusCode::BAD_REQUEST)
        );
        assert_eq!(
            validate_protocol_version(Some("nope")),
            Err(StatusCode::BAD_REQUEST)
        );
    }

    #[test]
    fn capabilities_serializes_camel_case() {
        let cap = bridge_capabilities();
        let json = serde_json::to_value(&cap).expect("serialize");
        assert_eq!(json["version"], BRIDGE_VERSION);
        assert_eq!(json["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(json["maxCommandTtlMs"], COMMAND_TTL_SECS * 1000);
        assert_eq!(json["connectedWindowMs"], CONNECTED_WINDOW_SECS * 1000);
        assert_eq!(json["supportsWebSocket"], true);
        assert_eq!(json["pushIntervalMs"], PUSH_INTERVAL_MS);
        assert_eq!(json["failThreshold"], FAIL_THRESHOLD);
        assert_eq!(json["httpPath"], BROWSER_MEDIA_PATH);
        assert!(json["wsUrl"]
            .as_str()
            .unwrap()
            .contains(&format!(":{BROWSER_WS_PORT}")));
    }
}
