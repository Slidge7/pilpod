use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::{ConnectInfo, State},
    http::{Method, StatusCode},
    response::IntoResponse,
    routing::{options, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

use crate::browser_tabs::BrowserMediaCommand;

use super::handler::{apply_ingest, convert_tab, BridgeContext, BridgeIngest, BrowserTabPost};
use super::{BROWSER_BRIDGE_PORT, BROWSER_MEDIA_PATH};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTabsPostResponse {
    ok: bool,
    commands: Vec<BrowserMediaCommand>,
    sync_now: bool,
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
    #[serde(default)]
    seq: u64,
}

fn is_loopback(addr: SocketAddr) -> bool {
    addr.ip().is_loopback()
}

fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::POST, Method::OPTIONS])
        .allow_headers([axum::http::header::CONTENT_TYPE])
}

async fn handle_post(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(ctx): State<Arc<BridgeContext>>,
    Json(payload): Json<BrowserTabsPost>,
) -> impl IntoResponse {
    if !is_loopback(peer) {
        return StatusCode::FORBIDDEN.into_response();
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

    let result = apply_ingest(
        BridgeIngest {
            browser_id,
            browser_name: payload.browser_name,
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

async fn handle_options(ConnectInfo(peer): ConnectInfo<SocketAddr>) -> impl IntoResponse {
    if !is_loopback(peer) {
        return StatusCode::FORBIDDEN.into_response();
    }
    StatusCode::NO_CONTENT.into_response()
}

pub fn router(ctx: Arc<BridgeContext>) -> Router {
    Router::new()
        .route(BROWSER_MEDIA_PATH, post(handle_post))
        .route(BROWSER_MEDIA_PATH, options(handle_options))
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
        "[browser-bridge] listening on http://{addr}{BROWSER_MEDIA_PATH}"
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
