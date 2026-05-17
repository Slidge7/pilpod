use std::{
    io::Read,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tiny_http::{Header, Method, Response, Server};

use crate::browser_tabs::{
    BrowserCommandsQueue, BrowserMediaCommand, BrowserSlot, BrowserTabsMap,
};
use crate::gsmtc::dto::BrowserTabMediaDto;
use crate::gsmtc::state::{emit_fast_to_ui, GsmtcState};

use super::{BROWSER_BRIDGE_PORT, BROWSER_MEDIA_PATH};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserMediaPostResponse {
    ok: bool,
    commands: Vec<BrowserMediaCommand>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserMediaPost {
    /// Stable UUID generated once per browser profile by the extension.
    #[serde(default)]
    browser_id: String,
    #[serde(default)]
    browser_name: String,
    #[serde(default)]
    connection_state: String,
    #[serde(default)]
    tabs: Vec<BrowserTabMediaDto>,
}

fn is_loopback(addr: &SocketAddr) -> bool {
    match addr.ip() {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

fn cors() -> [Header; 3] {
    [
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"POST, OPTIONS"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap(),
    ]
}

fn with_cors<R: Read>(r: Response<R>) -> Response<R> {
    let [h1, h2, h3] = cors();
    r.with_header(h1).with_header(h2).with_header(h3)
}

pub fn spawn(
    browser_tabs: BrowserTabsMap,
    command_queue: BrowserCommandsQueue,
    app: AppHandle,
    gsmtc_slot: Arc<Mutex<Option<Arc<GsmtcState>>>>,
) {
    let addr = format!("127.0.0.1:{BROWSER_BRIDGE_PORT}");
    let server = match Server::http(&addr) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[browser-bridge] could not bind {addr}: {e}");
            return;
        }
    };
    eprintln!("[browser-bridge] listening on http://{addr}{BROWSER_MEDIA_PATH}");

    std::thread::Builder::new()
        .name("browser-bridge".into())
        .spawn(move || {
            for mut req in server.incoming_requests() {
                let (is_loop, remote_port) = match req.remote_addr() {
                    Some(a) => (is_loopback(a), a.port()),
                    None => {
                        let _ = req.respond(Response::empty(403));
                        continue;
                    }
                };
                if !is_loop {
                    let _ = req.respond(Response::empty(403));
                    continue;
                }

                let path = req.url().split('?').next().unwrap_or(req.url());
                if path != BROWSER_MEDIA_PATH {
                    let _ = req.respond(with_cors(Response::empty(404)));
                    continue;
                }

                if *req.method() == Method::Options {
                    let _ = req.respond(with_cors(Response::empty(204)));
                    continue;
                }

                if *req.method() != Method::Post {
                    let _ = req.respond(with_cors(Response::empty(405)));
                    continue;
                }

                let mut body = String::new();
                if req.as_reader().read_to_string(&mut body).is_err() {
                    let _ = req.respond(Response::from_string("bad body").with_status_code(400));
                    continue;
                }

                match serde_json::from_str::<BrowserMediaPost>(&body) {
                    Ok(payload) => {
                        let browser_id = if payload.browser_id.is_empty() {
                            // Fallback: use remote port to differentiate browsers without IDs.
                            format!("unknown-{remote_port}")
                        } else {
                            payload.browser_id.clone()
                        };

                        let browser_name = payload.browser_name;
                        let connection_state = payload.connection_state;

                        // Tag each tab with profile metadata so the UI can show the source.
                        let tabs: Vec<BrowserTabMediaDto> = payload
                            .tabs
                            .into_iter()
                            .map(|mut t| {
                                t.browser_id = browser_id.clone();
                                t.browser_name = browser_name.clone();
                                t.connection_state = connection_state.clone();
                                t
                            })
                            .collect();

                        let browser_key = browser_id.clone();

                        // Update only this browser's slot — other browsers are untouched.
                        if let Ok(mut map) = browser_tabs.lock() {
                            map.insert(
                                browser_key.clone(),
                                BrowserSlot {
                                    last_seen: Instant::now(),
                                    connection_state,
                                    tabs,
                                },
                            );
                        }

                        if let Ok(slot) = gsmtc_slot.lock() {
                            if let Some(gs) = slot.as_ref() {
                                emit_fast_to_ui(&app, gs);
                            }
                        }

                        // Drain commands for this browser and discard any that
                        // have been sitting in the queue for more than 5 seconds
                        // (e.g. because the extension was reloading or offline).
                        let drained = if let Ok(mut q) = command_queue.lock() {
                            let now = Instant::now();
                            let cmd_ttl = Duration::from_secs(5);
                            q.remove(&browser_key)
                                .unwrap_or_default()
                                .into_iter()
                                .filter(|c| now.duration_since(c.enqueued_at) < cmd_ttl)
                                .collect()
                        } else {
                            Vec::new()
                        };
                        let reply = serde_json::to_string(&BrowserMediaPostResponse {
                            ok: true,
                            commands: drained,
                        })
                        .unwrap_or_else(|_| r#"{"ok":true,"commands":[]}"#.to_string());
                        let _ = req.respond(with_cors(
                            Response::from_data(reply.into_bytes()).with_status_code(200),
                        ));
                    }
                    Err(e) => {
                        eprintln!("[browser-bridge] json: {e}");
                        let _ = req.respond(
                            Response::from_string("invalid json").with_status_code(400),
                        );
                    }
                }
            }
        })
        .expect("spawn browser-bridge");
}
