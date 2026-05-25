//! Shared ingest logic for HTTP POST and WebSocket frames.

use std::{
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant},
};

use serde::Deserialize;
use tauri::AppHandle;

use crate::browser_bridge::connections::WsConnectionMap;
use crate::browser_detector::{
    browser_name_to_id, clear_reconnecting, emit_browsers_to_ui, DetectedBrowsersState,
    ExtensionInstalledState, ReconnectingBrowsersState,
};
use crate::browser_tabs::{
    hash_tabs, BrowserCommandsQueue, BrowserMediaCommand, BrowserSlot, BrowserSlotsMap,
};
use crate::gsmtc::dto::{BrowserTab, TabMedia};
use crate::gsmtc::state::{emit_fast_to_ui, GsmtcState};

use super::protocol::COMMAND_TTL_SECS;
use super::SyncRequestedFlag;

#[derive(Debug, Clone)]
pub struct BridgeIngest {
    pub browser_id: String,
    pub browser_name: String,
    pub is_ping: bool,
    pub tabs: Vec<BrowserTab>,
}

pub struct BridgeContext {
    pub browser_slots: BrowserSlotsMap,
    pub command_queue: BrowserCommandsQueue,
    pub app: AppHandle,
    pub gsmtc_slot: Arc<Mutex<Option<Arc<GsmtcState>>>>,
    pub detected_browsers: DetectedBrowsersState,
    pub ext_store: ExtensionInstalledState,
    pub reconnecting: ReconnectingBrowsersState,
    pub sync_flag: SyncRequestedFlag,
    pub ws_connections: WsConnectionMap,
}

pub struct BridgeResult {
    pub changed: bool,
    pub commands: Vec<BrowserMediaCommand>,
    pub sync_now: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabPost {
    pub tab_id: i64,
    #[serde(default)]
    pub window_id: i64,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub fav_icon_url: String,
    #[serde(default)]
    pub tab_state: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub window_focused: bool,
    #[serde(default)]
    pub audible: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub index: u32,
    #[serde(default)]
    pub media: Option<TabMediaPost>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabMediaPost {
    #[serde(default)]
    pub playback_state: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub artwork_url: String,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub current_time: f64,
    #[serde(default)]
    pub page_visible: bool,
    #[serde(default)]
    pub user_idle_ms: u64,
    #[serde(default)]
    pub document_state: String,
}

pub fn convert_tab(post: BrowserTabPost, browser_id: &str) -> BrowserTab {
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

pub fn apply_ingest(ingest: BridgeIngest, ctx: &BridgeContext) -> BridgeResult {
    let now = Instant::now();
    let incoming_hash = hash_tabs(&ingest.tabs);

    let changed = if let Ok(mut map) = ctx.browser_slots.lock() {
        match map.get_mut(&ingest.browser_id) {
            Some(existing) if ingest.is_ping => {
                existing.last_seen = now;
                false
            }
            Some(existing) => {
                let content_changed = existing.content_hash != incoming_hash;
                existing.last_seen = now;
                if content_changed {
                    existing.tabs = ingest.tabs;
                    existing.browser_name = ingest.browser_name.clone();
                    existing.content_hash = incoming_hash;
                }
                content_changed
            }
            None if ingest.is_ping => {
                map.insert(
                    ingest.browser_id.clone(),
                    BrowserSlot {
                        last_seen: now,
                        browser_id: ingest.browser_id.clone(),
                        browser_name: ingest.browser_name.clone(),
                        tabs: Vec::new(),
                        content_hash: incoming_hash,
                    },
                );
                false
            }
            None => {
                map.insert(
                    ingest.browser_id.clone(),
                    BrowserSlot {
                        last_seen: now,
                        browser_id: ingest.browser_id.clone(),
                        browser_name: ingest.browser_name.clone(),
                        tabs: ingest.tabs,
                        content_hash: incoming_hash,
                    },
                );
                true
            }
        }
    } else {
        false
    };

    let os_id = browser_name_to_id(&ingest.browser_name);
    if let Ok(mut store) = ctx.ext_store.lock() {
        store.mark_installed(&os_id);
    }

    let was_reconnecting = clear_reconnecting(&ctx.reconnecting, &ingest.browser_id);

    if changed || was_reconnecting {
        if let Ok(slot) = ctx.gsmtc_slot.lock() {
            if let Some(gs) = slot.as_ref() {
                emit_fast_to_ui(&ctx.app, gs);
            }
        }

        emit_browsers_to_ui(
            &ctx.app,
            &ctx.detected_browsers,
            &ctx.browser_slots,
            &ctx.ext_store,
            &ctx.reconnecting,
            &ctx.ws_connections,
        );
    }

    let drained = drain_commands(&ctx.command_queue, &ingest.browser_id);
    let sync_now = ctx.sync_flag.swap(false, Ordering::Relaxed);

    BridgeResult {
        changed,
        commands: drained,
        sync_now,
    }
}

pub fn drain_commands(
    command_queue: &BrowserCommandsQueue,
    browser_id: &str,
) -> Vec<BrowserMediaCommand> {
    if let Ok(mut q) = command_queue.lock() {
        let now = Instant::now();
        let cmd_ttl = Duration::from_secs(COMMAND_TTL_SECS);
        q.remove(browser_id)
            .unwrap_or_default()
            .into_values()
            .filter(|c| now.duration_since(c.enqueued_at) < cmd_ttl)
            .collect()
    } else {
        Vec::new()
    }
}

/// Invalidate all slots after system resume so the UI shows stale/reconnecting immediately.
pub fn invalidate_slots_on_resume(
    browser_slots: &BrowserSlotsMap,
    reconnecting: &ReconnectingBrowsersState,
) {
    let stale = Instant::now() - Duration::from_secs(60);
    if let Ok(mut map) = browser_slots.lock() {
        if let Ok(mut set) = reconnecting.lock() {
            for slot in map.values_mut() {
                slot.last_seen = stale;
                set.insert(slot.browser_id.clone());
            }
        }
    }
}
