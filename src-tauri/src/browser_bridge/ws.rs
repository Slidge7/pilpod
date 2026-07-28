//! WebSocket bridge server — protocol v2, primary (and only) data/command transport.
//!
//! Speaks the v2 contract (`/PROTOCOL.md`): `hello`→`welcome`, then `full`/`delta`
//! state sync, lossy `prog`, and immediate `cmd` push over the outbound channel.
//!
//! State strategy: the v2 wire is *additive over the existing slot model*. Deltas
//! are merged against the per-connection tab set and folded into the shared
//! `BrowserSlotsMap` via `apply_ingest`, so the detector / UI / audio code that
//! reads those maps keeps working unchanged.

use std::{
    net::SocketAddr,
    ops::ControlFlow,
    sync::Arc,
    time::{Duration, Instant},
};

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::handshake::server::{ErrorResponse, Request, Response},
    tungstenite::http::StatusCode,
    tungstenite::Message,
};

use crate::browser_detector::{clear_reconnecting, emit_on_connection_change};
use crate::browser_dto::{BrowserTab, TabMedia};

use super::connections::{register_ws_connection, unregister_ws_connection, WsConnectionMap};
use super::handler::{
    apply_ingest, apply_verified_handshake, BridgeContext, BridgeIngest,
};
use super::protocol::frames::{ClientMsg, ServerMsg, TabState};
use super::protocol::version::{self, negotiate};
use super::security::{action_from_str, origin_allowed, token_ok};
use super::{BROWSER_WS_PATH, BROWSER_WS_PORT};

/// Minimum interval between UI emits caused by high-frequency `prog` frames.
const PROG_EMIT_THROTTLE: Duration = Duration::from_millis(100);

fn is_loopback(addr: SocketAddr) -> bool {
    addr.ip().is_loopback()
}

/// Convert a v2 `TabState` into the internal `BrowserTab` DTO.
fn convert_tab_state(s: TabState, browser_id: &str) -> BrowserTab {
    BrowserTab {
        tab_id: s.tab_id,
        window_id: s.window_id,
        url: s.url,
        title: s.title,
        favicon_url: s.fav_icon_url,
        tab_state: if s.active { "active".into() } else { "inactive".into() },
        active: s.active,
        window_focused: s.window_focused,
        audible: s.audible,
        muted: s.muted,
        pinned: s.pinned,
        index: s.index,
        media: s.media.map(|m| TabMedia {
            playback_state: m.playback_state,
            title: m.title,
            artist: m.artist,
            album: m.album,
            artwork_url: m.artwork_url,
            duration: m.duration,
            current_time: m.current_time,
            page_visible: true,
            user_idle_ms: 0,
            document_state: String::new(),
            tab_volume: m.tab_volume,
            tab_muted: m.tab_muted,
            can_seek: m.can_seek,
            can_pip: m.can_pip,
            can_next: m.can_next,
            can_prev: m.can_prev,
            in_pip: m.in_pip,
        }),
        browser_id: browser_id.to_string(),
    }
}

/// Per-connection session state held on the handler task's stack.
struct Session {
    browser_id: Option<String>,
    browser_name: String,
    /// Catalog id verified from the socket's owning process (peer-PID match).
    verified_os_id: Option<String>,
    /// Merged tab set, used to fold deltas before handing a full list to `apply_ingest`.
    tabs: Vec<BrowserTab>,
    last_rev: u64,
    last_prog_emit: Instant,
    /// Tab ids we've asked the extension to stream live `prog` frames for.
    subscribed: std::collections::HashSet<i64>,
}

impl Session {
    fn new() -> Self {
        Self {
            browser_id: None,
            browser_name: String::new(),
            verified_os_id: None,
            tabs: Vec::new(),
            last_rev: 0,
            last_prog_emit: Instant::now() - PROG_EMIT_THROTTLE,
            subscribed: std::collections::HashSet::new(),
        }
    }
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    ctx: Arc<BridgeContext>,
    ws_connections: WsConnectionMap,
) {
    // Phase 3: identify the connecting browser by its process, before the
    // handshake consumes the stream. Ground truth — beats any self-report.
    let verified_os_id = stream
        .peer_addr()
        .ok()
        .and_then(|peer| super::peer_pid::verified_os_id_for_peer(peer, super::BROWSER_WS_PORT));
    // Origin allowlist enforced during the upgrade handshake (Phase 5 security).
    //
    // The large `Err` variant is tungstenite's `ErrorResponse` — the callback
    // signature is fixed by `accept_hdr_async`, so boxing it is not an option.
    #[allow(clippy::result_large_err)]
    let origin_check = |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        let origin = req
            .headers()
            .get("origin")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if origin_allowed(origin) {
            Ok(resp)
        } else {
            eprintln!("[browser-bridge-ws] rejected origin: {origin:?}");
            let err: ErrorResponse = tokio_tungstenite::tungstenite::http::Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Some("origin not allowed".to_string()))
                .expect("build error response");
            Err(err)
        }
    };

    let ws = match accept_hdr_async(stream, origin_check).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[browser-bridge-ws] handshake failed: {e}");
            return;
        }
    };

    let (mut write, mut read) = ws.split();
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let mut session = Session::new();
    session.verified_os_id = verified_os_id;

    // Server-driven keepalive: emit `ping` on the same cadence we advertise in
    // `welcome.caps.idlePingMs`, so an otherwise-silent (medialess) connection
    // keeps feeding the extension's inbound watchdog and is not torn down. The
    // client always answers with `pong`. `Delay` prevents a catch-up burst after
    // the task is starved.
    let mut ping_seq: u64 = 0;
    let mut ping_timer =
        tokio::time::interval(Duration::from_millis(version::IDLE_PING_MS.max(1)));
    ping_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // Skip the immediate first tick so we don't ping before `hello`/`welcome`.
    ping_timer.tick().await;

    loop {
        tokio::select! {
            _ = ping_timer.tick() => {
                // Only ping an identified (post-hello) connection.
                if session.browser_id.is_some() {
                    ping_seq += 1;
                    let frame = ServerMsg::Ping { seq: ping_seq }.to_frame();
                    if write.send(Message::Text(frame)).await.is_err() {
                        break;
                    }
                }
            }
            inbound = read.next() => {
                let Some(msg) = inbound else { break };
                let Ok(msg) = msg else { break };
                match msg {
                    Message::Text(text) => {
                        let parsed: ClientMsg = match serde_json::from_str(&text) {
                            Ok(v) => v,
                            Err(e) => {
                                eprintln!("[browser-bridge-ws] frame parse: {e}");
                                continue;
                            }
                        };
                        if handle_client_msg(parsed, &mut session, &ctx, &ws_connections, &out_tx)
                            .is_break()
                        {
                            break;
                        }
                    }
                    Message::Close(_) => break,
                    // False positive: clippy suggests folding this into a match
                    // guard, but guards cannot contain `.await`.
                    #[allow(clippy::collapsible_match)]
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

    teardown(session, &ctx, &ws_connections);
}

fn handle_client_msg(
    msg: ClientMsg,
    session: &mut Session,
    ctx: &Arc<BridgeContext>,
    ws_connections: &WsConnectionMap,
    out_tx: &tokio::sync::mpsc::UnboundedSender<String>,
) -> ControlFlow<()> {
    match msg {
        ClientMsg::Hello { v, browser_id, browser, ext_version, token, caps } => {
            if negotiate(v).is_err() {
                eprintln!("[browser-bridge-ws] unsupported protocol v{v}");
                return ControlFlow::Break(());
            }
            // Min-version gate (PROTOCOL.md §5.3). Fail-closed only when the client
            // reports a version that is too old; an absent version is not a hard
            // block so a first-run extension can still pair.
            if !ext_version.is_empty()
                && !version::version_at_least(&ext_version, version::MIN_EXT_VERSION)
            {
                eprintln!(
                    "[browser-bridge-ws] rejected extVersion {ext_version} (min {})",
                    version::MIN_EXT_VERSION
                );
                return ControlFlow::Break(());
            }
            if !token_ok(token.as_deref()) {
                eprintln!("[browser-bridge-ws] rejected pairing token");
                return ControlFlow::Break(());
            }
            if browser_id.is_empty() {
                return ControlFlow::Break(());
            }
            session.browser_name = browser.map(|b| b.name).unwrap_or_default();
            session.browser_id = Some(browser_id.clone());

            // Surface self-report vs PID-verified conflicts (e.g. Brave saying "Chrome").
            if let Some(verified) = &session.verified_os_id {
                let reported = crate::browser_detector::browser_name_to_id(&session.browser_name);
                if reported != *verified {
                    eprintln!(
                        "[browser-bridge-ws] binding conflict: extension says {:?} ({reported}), \
                         socket owner is {verified} — using {verified}",
                        session.browser_name
                    );
                }
            } else {
                eprintln!(
                    "[browser-bridge-ws] peer-PID lookup failed for {:?} — falling back to self-report",
                    session.browser_name
                );
            }

            register_ws_connection(ws_connections, &browser_id, out_tx.clone(), caps.nav);
            clear_reconnecting(&ctx.reconnecting, &browser_id);

            // Activate here, not on the first `full`.
            //
            // `hello` is the earliest moment we know *which* browser this is,
            // and peer-PID attribution has already run at socket accept. Waiting
            // for `full` would leave the browser's row locked for an extra
            // round trip, and would strand any client that connects but has
            // nothing to report yet. It also gets the ordering right: the emit
            // below then carries the new `active` state instead of a stale one.
            apply_verified_handshake(&ctx.app, session.verified_os_id.as_deref());

            emit_on_connection_change(
                &ctx.app,
                &ctx.detected_browsers,
                &ctx.browser_slots,
                &ctx.ext_store,
                &ctx.reconnecting,
                ws_connections,
            );

            // Server-driven config replaces the v1 GET /capabilities.
            let welcome = ServerMsg::Welcome {
                v: version::PROTOCOL_VERSION,
                bridge: version::BRIDGE_VERSION.to_string(),
                session_id: browser_id,
                caps: version::default_caps(),
            };
            let _ = out_tx.send(welcome.to_frame());
            ControlFlow::Continue(())
        }

        ClientMsg::Full { rev, tabs } => {
            let Some(id) = session.browser_id.clone() else { return ControlFlow::Continue(()) };
            session.tabs = tabs.into_iter().map(|t| convert_tab_state(t, &id)).collect();
            session.last_rev = rev;
            ingest_and_push(session, ctx, out_tx, false);
            reconcile_subscriptions(session, out_tx);
            ControlFlow::Continue(())
        }

        ClientMsg::Delta { rev, upsert, remove } => {
            let Some(id) = session.browser_id.clone() else { return ControlFlow::Continue(()) };
            // Gap detection — fail closed by asking for a fresh snapshot.
            if rev != session.last_rev + 1 {
                let _ = out_tx.send(ServerMsg::Resync.to_frame());
                return ControlFlow::Continue(());
            }
            for tab in upsert {
                let converted = convert_tab_state(tab, &id);
                if let Some(slot) = session.tabs.iter_mut().find(|t| t.tab_id == converted.tab_id) {
                    *slot = converted;
                } else {
                    session.tabs.push(converted);
                }
            }
            if !remove.is_empty() {
                session.tabs.retain(|t| !remove.contains(&t.tab_id));
            }
            session.last_rev = rev;
            ingest_and_push(session, ctx, out_tx, false);
            reconcile_subscriptions(session, out_tx);
            ControlFlow::Continue(())
        }

        ClientMsg::Prog { id, ct, st, d } => {
            if let Some(tab) = session.tabs.iter_mut().find(|t| t.tab_id == id) {
                if let Some(media) = tab.media.as_mut() {
                    media.current_time = ct;
                    media.playback_state =
                        if st == 1 { "playing".into() } else { "paused".into() };
                    if let Some(dur) = d {
                        media.duration = dur;
                    }
                }
            }
            // Throttle UI churn from high-frequency progress.
            if session.last_prog_emit.elapsed() >= PROG_EMIT_THROTTLE {
                session.last_prog_emit = Instant::now();
                ingest_and_push(session, ctx, out_tx, true);
            }
            ControlFlow::Continue(())
        }

        // pong / unsolicited keepalive — refresh liveness only.
        ClientMsg::Pong { .. } => {
            ingest_ping(session, ctx);
            ControlFlow::Continue(())
        }

        ClientMsg::Ack { .. } => ControlFlow::Continue(()),

        // Player-tab creation result — hand off to the playlist player.
        ClientMsg::Opened { id, ok, tab_id, window_id, error } => {
            if let Some(browser_id) = session.browser_id.as_deref() {
                crate::playlist_player::on_opened(
                    &ctx.app, browser_id, &id, ok, tab_id, window_id, error,
                );
            }
            ControlFlow::Continue(())
        }

        ClientMsg::Bye => ControlFlow::Break(()),
    }
}

/// Fold the merged tab set into the shared slot map and push any queued commands.
fn ingest_and_push(
    session: &Session,
    ctx: &Arc<BridgeContext>,
    out_tx: &tokio::sync::mpsc::UnboundedSender<String>,
    is_prog: bool,
) {
    let Some(id) = session.browser_id.clone() else { return };

    // Let the playlist player observe the merged tab set (track-end detection,
    // player-tab adoption/loss). Cheap no-op when no playlist session is active.
    crate::playlist_player::observe_tabs(&ctx.app, &id, &session.tabs, &ctx.ws_connections);

    let result = apply_ingest(
        BridgeIngest {
            browser_id: id,
            browser_name: session.browser_name.clone(),
            verified_os_id: session.verified_os_id.clone(),
            is_ping: false,
            tabs: session.tabs.clone(),
        },
        ctx,
    );

    // prog updates never carry queued commands worth a round-trip.
    if is_prog {
        return;
    }

    // Deliver any commands enqueued while the socket was down as immediate `cmd`s.
    for cmd in result.commands {
        let Some(action) = action_from_str(&cmd.action) else { continue };
        let frame = ServerMsg::Cmd {
            id: format!("q-{}", cmd.tab_id),
            tab_id: cmd.tab_id as i64,
            action,
            value: cmd.value,
        };
        let _ = out_tx.send(frame.to_frame());
    }
}

/// Ask the extension to stream live `prog` frames for exactly the tabs that
/// currently carry media, and stop streaming ones that no longer do.
///
/// Without this the extension keeps `prog` frames gated behind an (empty)
/// subscription set, so the desktop only ever learns `current_time` from
/// `full`/`delta` snapshots — i.e. the position looks frozen until the next
/// state change (play/pause). Sending `sub`/`unsub` keeps it ticking live.
fn reconcile_subscriptions(
    session: &mut Session,
    out_tx: &tokio::sync::mpsc::UnboundedSender<String>,
) {
    let desired: std::collections::HashSet<i64> = session
        .tabs
        .iter()
        .filter(|t| t.media.is_some())
        .map(|t| t.tab_id)
        .collect();

    // Subscribe to tabs that gained media.
    for &id in &desired {
        if session.subscribed.insert(id) {
            let _ = out_tx.send(ServerMsg::Sub { tab_id: id }.to_frame());
        }
    }

    // Unsubscribe from tabs that lost media or were removed.
    let stale: Vec<i64> = session
        .subscribed
        .iter()
        .filter(|id| !desired.contains(id))
        .copied()
        .collect();
    for id in stale {
        session.subscribed.remove(&id);
        let _ = out_tx.send(ServerMsg::Unsub { tab_id: id }.to_frame());
    }
}

/// Touch `last_seen` without changing tab content (keepalive path).
fn ingest_ping(session: &Session, ctx: &Arc<BridgeContext>) {
    let Some(id) = session.browser_id.clone() else { return };
    let _ = apply_ingest(
        BridgeIngest {
            browser_id: id,
            browser_name: session.browser_name.clone(),
            verified_os_id: session.verified_os_id.clone(),
            is_ping: true,
            tabs: Vec::new(),
        },
        ctx,
    );
}

fn teardown(session: Session, ctx: &Arc<BridgeContext>, ws_connections: &WsConnectionMap) {
    if let Some(id) = session.browser_id {
        if let Ok(mut set) = ctx.reconnecting.lock() {
            set.insert(id.clone());
        }
        if let Ok(mut map) = ctx.browser_slots.lock() {
            if let Some(slot) = map.get_mut(&id) {
                slot.last_seen = Instant::now() - Duration::from_secs(60);
            }
        }
        unregister_ws_connection(ws_connections, &id);
        emit_on_connection_change(
            &ctx.app,
            &ctx.detected_browsers,
            &ctx.browser_slots,
            &ctx.ext_store,
            &ctx.reconnecting,
            ws_connections,
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

    eprintln!("[browser-bridge-ws] v2 listening on ws://{addr}{BROWSER_WS_PATH}");

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
