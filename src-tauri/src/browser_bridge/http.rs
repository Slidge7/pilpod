use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::{ConnectInfo, State},
    http::{Method, StatusCode},
    response::{Html, IntoResponse},
    routing::{get, options, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

use crate::browser_tabs::BrowserMediaCommand;

use super::handler::{apply_ingest, convert_tab, BridgeContext, BridgeIngest, BrowserTabPost};
use super::protocol::version;
use super::protocol::{bridge_capabilities, validate_protocol_version, CAPABILITIES_PATH};
use super::{BROWSER_BRIDGE_PORT, BROWSER_MEDIA_PATH, BROWSER_WS_PORT};

/// Path for the cheap "is the app running / which port" probe (v2 discovery).
pub const HEALTH_PATH: &str = "/health";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTabsPostResponse {
    ok: bool,
    commands: Vec<BrowserMediaCommand>,
    sync_now: bool,
}

/// v2 discovery payload. Never carries data — only liveness + port + min version.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    app: &'static str,
    bridge: u8,
    ws_port: u16,
    min_ext_version: &'static str,
}

async fn handle_health(ConnectInfo(peer): ConnectInfo<SocketAddr>) -> impl IntoResponse {
    if !is_loopback(peer) {
        return StatusCode::FORBIDDEN.into_response();
    }
    Json(HealthResponse {
        app: "pilpod",
        bridge: version::PROTOCOL_VERSION,
        ws_port: BROWSER_WS_PORT,
        min_ext_version: version::MIN_EXT_VERSION,
    })
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTabsPost {
    #[serde(default)]
    browser_id: String,
    #[serde(default)]
    browser_name: String,
    #[serde(default)]
    tabs: Vec<BrowserTabPost>,
    #[serde(default)]
    ping: bool,
    /// Sent by the extension per PROTOCOL.md; accepted but not yet consumed.
    #[serde(default)]
    #[allow(dead_code)]
    seq: u64,
    #[serde(default)]
    protocol_version: String,
}

fn is_loopback(addr: SocketAddr) -> bool {
    addr.ip().is_loopback()
}

fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([axum::http::header::CONTENT_TYPE])
}

async fn handle_capabilities(ConnectInfo(peer): ConnectInfo<SocketAddr>) -> impl IntoResponse {
    if !is_loopback(peer) {
        return StatusCode::FORBIDDEN.into_response();
    }
    Json(bridge_capabilities()).into_response()
}

async fn handle_post(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(ctx): State<Arc<BridgeContext>>,
    Json(payload): Json<BrowserTabsPost>,
) -> impl IntoResponse {
    if !is_loopback(peer) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let version = if payload.protocol_version.is_empty() {
        None
    } else {
        Some(payload.protocol_version.as_str())
    };
    if let Err(status) = validate_protocol_version(version) {
        return status.into_response();
    }

    let browser_id = if payload.browser_id.is_empty() {
        format!("unknown-{}", peer.port())
    } else {
        payload.browser_id.clone()
    };

    let tabs = if payload.ping {
        Vec::new()
    } else {
        payload
            .tabs
            .into_iter()
            .map(|t| convert_tab(t, &browser_id))
            .collect()
    };

    // Phase 3: identify the posting browser by the owning process of the
    // loopback connection (cached per peer port — heartbeats are chatty).
    let verified_os_id =
        super::peer_pid::cached_verified_os_id_for_peer(peer, BROWSER_BRIDGE_PORT);

    let result = apply_ingest(
        BridgeIngest {
            browser_id,
            browser_name: payload.browser_name,
            verified_os_id,
            is_ping: payload.ping,
            tabs,
        },
        &ctx,
    );

    Json(BrowserTabsPostResponse {
        ok: true,
        commands: result.commands,
        sync_now: result.sync_now,
    })
    .into_response()
}

/// Page Chromium opens when the companion is uninstalled. The companion sets
/// this as its uninstall URL with its `browserId` in the query — that stored
/// URL is how `browser_profiles` ties a profile folder to a connection. The
/// page itself only says goodbye: it changes no state, so a web page that
/// requests it can do nothing.
const COMPANION_REMOVED_PAGE: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>PilPod Companion removed</title>
<style>
  body{font:15px/1.5 system-ui,Segoe UI,sans-serif;background:#111318;color:#e8e9ed;
       display:grid;place-items:center;min-height:100vh;margin:0}
  main{max-width:28rem;padding:2rem;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{color:#a3a7b3;margin:.25rem 0}
</style></head>
<body><main>
  <h1>PilPod Companion was removed from this profile</h1>
  <p>PilPod will no longer see or control the tabs in this browser profile.</p>
  <p>You can reinstall it any time from PilPod's browser setup. You can close this tab.</p>
</main></body></html>"#;

async fn handle_companion_removed(ConnectInfo(peer): ConnectInfo<SocketAddr>) -> impl IntoResponse {
    if !is_loopback(peer) {
        return StatusCode::FORBIDDEN.into_response();
    }
    Html(COMPANION_REMOVED_PAGE).into_response()
}

async fn handle_options(ConnectInfo(peer): ConnectInfo<SocketAddr>) -> impl IntoResponse {
    if !is_loopback(peer) {
        return StatusCode::FORBIDDEN.into_response();
    }
    StatusCode::NO_CONTENT.into_response()
}

pub fn router(ctx: Arc<BridgeContext>) -> Router {
    Router::new()
        .route(HEALTH_PATH, get(handle_health))
        .route(CAPABILITIES_PATH, get(handle_capabilities))
        .route(CAPABILITIES_PATH, options(handle_options))
        .route(BROWSER_MEDIA_PATH, post(handle_post))
        .route(BROWSER_MEDIA_PATH, options(handle_options))
        .route(
            crate::browser_profiles::UNINSTALL_PATH,
            get(handle_companion_removed),
        )
        .layer(cors_layer())
        .with_state(ctx)
}

pub async fn run_http_server(ctx: Arc<BridgeContext>) {
    let addr = format!("127.0.0.1:{BROWSER_BRIDGE_PORT}");
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[browser-bridge] could not bind {addr}: {e}");
            return;
        }
    };

    eprintln!(
        "[browser-bridge] listening on http://{addr}{BROWSER_MEDIA_PATH} and http://{addr}{CAPABILITIES_PATH}"
    );

    if let Err(e) = axum::serve(
        listener,
        router(ctx).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    {
        eprintln!("[browser-bridge] server error: {e}");
    }
}
