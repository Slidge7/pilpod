//! WebSocket bridge server — primary transport for the companion extension.

use std::{net::SocketAddr, sync::Arc};

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};

use crate::browser_detector::emit_on_connection_change;

use super::connections::{register_ws_connection, unregister_ws_connection, WsConnectionMap};
use super::handler::{apply_ingest, convert_tab, BridgeContext, BridgeIngest, BrowserTabPost};
use super::{BROWSER_WS_PATH, BROWSER_WS_PORT};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WsClientMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(default)]
    browser_id: String,
    #[serde(default)]
    browser_name: String,
    #[serde(default)]
    tabs: Vec<BrowserTabPost>,
    #[serde(default)]
    seq: u64,
}

fn is_loopback(addr: SocketAddr) -> bool {
    addr.ip().is_loopback()
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    ctx: Arc<BridgeContext>,
    ws_connections: WsConnectionMap,
) {
    let ws = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[browser-bridge-ws] handshake failed: {e}");
            return;
        }
    };

    let (mut write, mut read) = ws.split();
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let mut registered_id: Option<String> = None;

    loop {
        tokio::select! {
            inbound = read.next() => {
                let Some(msg) = inbound else { break };
                let Ok(msg) = msg else { break };
                match msg {
                    Message::Text(text) => {
                        let parsed: WsClientMessage = match serde_json::from_str(&text) {
                            Ok(v) => v,
                            Err(e) => {
                                eprintln!("[browser-bridge-ws] json parse: {e}");
                                continue;
                            }
                        };

                        if parsed.browser_id.is_empty() {
                            continue;
                        }

                        if registered_id.is_none() {
                            registered_id = Some(parsed.browser_id.clone());
                            register_ws_connection(
                                &ws_connections,
                                &parsed.browser_id,
                                out_tx.clone(),
                            );
                            emit_on_connection_change(
                                &ctx.app,
                                &ctx.detected_browsers,
                                &ctx.browser_slots,
                                &ctx.ext_store,
                                &ctx.reconnecting,
                            );
                        }

                        let is_ping = parsed.msg_type == "ping";
                        let tabs = if is_ping {
                            Vec::new()
                        } else {
                            parsed
                                .tabs
                                .into_iter()
                                .map(|t| convert_tab(t, &parsed.browser_id))
                                .collect()
                        };

                        let result = apply_ingest(
                            BridgeIngest {
                                browser_id: parsed.browser_id.clone(),
                                browser_name: parsed.browser_name,
                                is_ping,
                                tabs,
                            },
                            &ctx,
                        );

                        let reply = serde_json::json!({
                            "commands": result.commands,
                            "syncNow": result.sync_now,
                        });
                        if out_tx.send(reply.to_string()).is_err() {
                            break;
                        }
                    }
                    Message::Close(_) => break,
                    Message::Ping(p) => {
                        if write.send(Message::Pong(p)).await.is_err() {
                            break;
                        }
                    }
                    _ => {}
                }
            }
            outbound = out_rx.recv() => {
                let Some(frame) = outbound else { break };
                if write.send(Message::Text(frame)).await.is_err() {
                    break;
                }
            }
        }
    }

    if let Some(id) = registered_id {
        unregister_ws_connection(&ws_connections, &id);
        emit_on_connection_change(
            &ctx.app,
            &ctx.detected_browsers,
            &ctx.browser_slots,
            &ctx.ext_store,
            &ctx.reconnecting,
        );
    }
}

pub async fn run_ws_server(ctx: Arc<BridgeContext>, ws_connections: WsConnectionMap) {
    let addr = format!("127.0.0.1:{BROWSER_WS_PORT}");
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[browser-bridge-ws] could not bind {addr}: {e}");
            return;
        }
    };

    eprintln!("[browser-bridge-ws] listening on ws://{addr}{BROWSER_WS_PATH}");

    loop {
        let Ok((stream, peer)) = listener.accept().await else {
            continue;
        };

        if !is_loopback(peer) {
            continue;
        }

        let ctx = Arc::clone(&ctx);
        let ws_connections = Arc::clone(&ws_connections);
        tokio::spawn(handle_connection(stream, ctx, ws_connections));
    }
}
