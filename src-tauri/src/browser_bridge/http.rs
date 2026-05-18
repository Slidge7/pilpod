use std::{
    io::Read,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tiny_http::{Header, Method, Response, Server};

use crate::browser_detector::{emit_browsers_to_ui, DetectedBrowsersState};
use crate::browser_tabs::{
    BrowserCommandsQueue, BrowserMediaCommand, BrowserSlot, BrowserSlotsMap,
};
use crate::gsmtc::dto::{BrowserTab, TabMedia};
use crate::gsmtc::state::{emit_fast_to_ui, GsmtcState};

use super::{BROWSER_BRIDGE_PORT, BROWSER_MEDIA_PATH};

// ── Response / request types ─────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTabsPostResponse {
    ok: bool,
    commands: Vec<BrowserMediaCommand>,
}

/// Incoming POST body from the companion extension.
/// All fields are optional/defaulted so the extension can omit unused ones.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTabsPost {
    /// Stable UUID generated once per browser profile by the extension.
    #[serde(default)]
    browser_id: String,
    /// Human-readable browser name (e.g. "Chrome", "Brave").
    #[serde(default)]
    browser_name: String,
    /// All open tabs in this browser profile — each with an optional `media` block.
    #[serde(default)]
    tabs: Vec<BrowserTabPost>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTabPost {
    tab_id: i64,
    #[serde(default)]
    window_id: i64,
    #[serde(default)]
    url: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    fav_icon_url: String,
    /// "active" | "inactive" | "loading" | "sleeping" | "crashed" | "unknown"
    #[serde(default)]
    tab_state: String,
    #[serde(default)]
    active: bool,
    /// True when the tab's window is the focused browser window.
    #[serde(default)]
    window_focused: bool,
    #[serde(default)]
    audible: bool,
    #[serde(default)]
    muted: bool,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    index: u32,
    /// `null` when the content script detected no media.
    #[serde(default)]
    media: Option<TabMediaPost>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TabMediaPost {
    /// "playing" | "paused" | "none"
    #[serde(default)]
    playback_state: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    artist: String,
    #[serde(default)]
    album: String,
    #[serde(default)]
    artwork_url: String,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    current_time: f64,
    #[serde(default)]
    page_visible: bool,
    #[serde(default)]
    user_idle_ms: u64,
    #[serde(default)]
    document_state: String,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

fn convert_tab(post: BrowserTabPost, browser_id: &str) -> BrowserTab {
    BrowserTab {
        tab_id: post.tab_id,
        window_id: post.window_id,
        url: post.url,
        title: post.title,
        favicon_url: post.fav_icon_url,
        tab_state: post.tab_state,
        active: post.active,
        window_focused: post.window_focused,
        audible: post.audible,
        muted: post.muted,
        pinned: post.pinned,
        index: post.index,
        media: post.media.map(|m| TabMedia {
            playback_state: m.playback_state,
            title: m.title,
            artist: m.artist,
            album: m.album,
            artwork_url: m.artwork_url,
            duration: m.duration,
            current_time: m.current_time,
            page_visible: m.page_visible,
            user_idle_ms: m.user_idle_ms,
            document_state: m.document_state,
        }),
        browser_id: browser_id.to_string(),
    }
}

// ── Server ───────────────────────────────────────────────────────────────────

pub fn spawn(
    browser_slots: BrowserSlotsMap,
    command_queue: BrowserCommandsQueue,
    app: AppHandle,
    gsmtc_slot: Arc<Mutex<Option<Arc<GsmtcState>>>>,
    detected_browsers: DetectedBrowsersState,
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
                    let _ = req.respond(
                        Response::from_string("bad body").with_status_code(400),
                    );
                    continue;
                }

                match serde_json::from_str::<BrowserTabsPost>(&body) {
                    Ok(payload) => {
                        let browser_id = if payload.browser_id.is_empty() {
                            format!("unknown-{remote_port}")
                        } else {
                            payload.browser_id.clone()
                        };
                        let browser_name = payload.browser_name.clone();

                        // Convert POST tabs to unified BrowserTab, stamp browser_id.
                        let tabs: Vec<BrowserTab> = payload
                            .tabs
                            .into_iter()
                            .map(|t| convert_tab(t, &browser_id))
                            .collect();

                        // Update the slot for this browser (other browsers untouched).
                        if let Ok(mut map) = browser_slots.lock() {
                            map.insert(
                                browser_id.clone(),
                                BrowserSlot {
                                    last_seen: Instant::now(),
                                    browser_id: browser_id.clone(),
                                    browser_name,
                                    tabs,
                                },
                            );
                        }

                        // Notify GSMTC so it can refresh the dedup decision.
                        if let Ok(slot) = gsmtc_slot.lock() {
                            if let Some(gs) = slot.as_ref() {
                                emit_fast_to_ui(&app, gs);
                            }
                        }

                        // Emit the merged browser list to the frontend.
                        emit_browsers_to_ui(&app, &detected_browsers, &browser_slots);

                        // Drain pending commands for this browser (TTL = 5 s).
                        let drained = if let Ok(mut q) = command_queue.lock() {
                            let now = Instant::now();
                            let cmd_ttl = Duration::from_secs(5);
                            q.remove(&browser_id)
                                .unwrap_or_default()
                                .into_iter()
                                .filter(|c| now.duration_since(c.enqueued_at) < cmd_ttl)
                                .collect()
                        } else {
                            Vec::new()
                        };

                        let reply = serde_json::to_string(&BrowserTabsPostResponse {
                            ok: true,
                            commands: drained,
                        })
                        .unwrap_or_else(|_| r#"{"ok":true,"commands":[]}"#.to_string());

                        let _ = req.respond(with_cors(
                            Response::from_data(reply.into_bytes())
                                .with_status_code(200),
                        ));
                    }
                    Err(e) => {
                        eprintln!("[browser-bridge] json parse: {e}");
                        let _ = req.respond(
                            Response::from_string("invalid json").with_status_code(400),
                        );
                    }
                }
            }
        })
        .expect("spawn browser-bridge");
}
