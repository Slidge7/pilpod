//! Local HTTP endpoint so the Chromium companion extension can POST per-tab media.
//! Each browser instance sends a stable `browserId`; the backend keeps one slot per
//! browser so Opera and Chrome never overwrite each other. Slots that haven't been
//! updated for STALE_SECS seconds are dropped from the merged snapshot.
//!
//! Bind: 127.0.0.1 only. See `extensions/pilpod-companion`.

use std::{
    collections::HashMap,
    io::Read,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tiny_http::{Header, Method, Response, Server};

use crate::gsmtc::dto::BrowserTabMediaDto;
use crate::gsmtc::state::{emit_fast_to_ui, GsmtcState};

pub const BROWSER_BRIDGE_PORT: u16 = 17_399;
pub const BROWSER_MEDIA_PATH: &str = "/browser-media";

/// How long a browser slot stays in the merged list after its last POST.
const STALE_SECS: u64 = 10;

/// Key: browserId UUID sent by the extension.
/// Value: (last_seen, tabs from that browser).
pub type BrowserTabsMap = Arc<Mutex<HashMap<String, (Instant, Vec<BrowserTabMediaDto>)>>>;

/// Commands the desktop app queues for a browser profile; the companion extension
/// receives them in the JSON body of its next POST to `/browser-media`.
pub type BrowserCommandsQueue = Arc<Mutex<HashMap<String, Vec<BrowserMediaCommand>>>>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMediaCommand {
    pub tab_id: i32,
    /// `playPause`, `next`, or `previous`
    pub action: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserMediaPostResponse {
    ok: bool,
    commands: Vec<BrowserMediaCommand>,
}

pub fn enqueue_browser_command(
    queue: &BrowserCommandsQueue,
    browser_id: &str,
    tab_id: i32,
    action: &str,
) {
    if let Ok(mut q) = queue.lock() {
        q.entry(browser_id.to_string())
            .or_default()
            .push(BrowserMediaCommand {
                tab_id,
                action: action.to_string(),
            });
    }
}

/// Build the flat list the snapshot exposes to the UI, dropping stale browser slots.
pub fn flatten_tabs(map: &HashMap<String, (Instant, Vec<BrowserTabMediaDto>)>) -> Vec<BrowserTabMediaDto> {
    let now = Instant::now();
    let stale = Duration::from_secs(STALE_SECS);
    map.values()
        .filter(|(last, _)| now.duration_since(*last) < stale)
        .flat_map(|(_, tabs)| tabs.clone())
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserMediaPost {
    /// Stable UUID generated once per browser profile by the extension.
    #[serde(default)]
    browser_id: String,
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
                    Some(a) => (is_loopback(&a), a.port()),
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

                        // Tag each tab with its browser_id so the UI can show the source.
                        let tabs: Vec<BrowserTabMediaDto> = payload
                            .tabs
                            .into_iter()
                            .map(|mut t| {
                                t.browser_id = browser_id.clone();
                                t
                            })
                            .collect();

                        let browser_key = browser_id.clone();

                        // Update only this browser's slot — other browsers are untouched.
                        if let Ok(mut map) = browser_tabs.lock() {
                            map.insert(browser_key.clone(), (Instant::now(), tabs));
                        }

                        if let Ok(slot) = gsmtc_slot.lock() {
                            if let Some(gs) = slot.as_ref() {
                                emit_fast_to_ui(&app, gs);
                            }
                        }

                        let drained = if let Ok(mut q) = command_queue.lock() {
                            q.remove(&browser_key).unwrap_or_default()
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

#[tauri::command]
pub fn browser_media_control(
    queue: tauri::State<'_, BrowserCommandsQueue>,
    browser_id: String,
    tab_id: i32,
    action: String,
) -> Result<(), String> {
    if browser_id.is_empty() {
        return Err("browserId is required".into());
    }
    let a = action.trim().to_ascii_lowercase();
    let normalized = match a.as_str() {
        "playpause" | "play_pause" | "toggle" => "playPause",
        "next" | "skipnext" => "next",
        "previous" | "prev" | "skipprevious" => "previous",
        _ => return Err(format!("unknown action: {action}")),
    };
    enqueue_browser_command(&queue, &browser_id, tab_id, normalized);
    Ok(())
}
