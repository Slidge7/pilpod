//! YouTube blocker — block a YouTube video by its link, and skip it every time
//! it plays in a tab the user is not looking at.
//!
//! Flow
//!   * The user blocks a video from a tab card (`youtube_block_add`). PilPod
//!     stores its id, title and link, and records a `blocked` history entry.
//!   * Every tab snapshot the bridge receives is checked by [`enforce`]. A tab
//!     showing a blocked video is skipped immediately — the player's "next",
//!     or closing the tab when "next" is unavailable or did not work — and a
//!     `skipped` history entry is recorded.
//!   * **A tab that is in focus is never skipped** (see [`logic::in_focus`]:
//!     the selected tab of the browser window that has OS focus). When the user
//!     switches away, the next snapshot reports it unfocused and it is skipped.
//!
//! Layout: `logic` (pure rules, unit-tested) → this file (store, service,
//! commands, bridge hook). Persistence is one small JSON file written
//! atomically, `app_data_dir()/youtube_block.json`.
//!
//! Integration points: `lib.rs` (mod decl), `app/handlers.rs` (commands),
//! `app/mod.rs` (init) and one call to [`enforce`] in `browser_bridge/ws.rs`.

#![cfg_attr(not(windows), allow(dead_code))]

pub mod logic;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use logic::SkipAction;

/// Full snapshot ([`Snapshot`]) after any change.
pub const EVT_CHANGED: &str = "youtube-block://changed";

pub const ERR_NOT_A_VIDEO: &str = "not_a_youtube_video";
pub const ERR_UNAVAILABLE: &str = "youtube_block_unavailable";

const FILE_NAME: &str = "youtube_block.json";
const STORE_VERSION: u32 = 1;
/// Oldest history entries are dropped past this many.
const MAX_EVENTS: usize = 2000;
/// Per-profile guard entries kept before the table is reset.
const MAX_GUARDS: usize = 512;

// ── DTOs (camelCase, mirrored in src/features/youtube-block/types.ts) ───────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedVideo {
    pub video_id: String,
    pub title: String,
    pub url: String,
    pub blocked_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventKind {
    /// The user blocked a video.
    Blocked,
    /// The user unblocked a video.
    Unblocked,
    /// A blocked video was skipped automatically.
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkipKind {
    Next,
    Close,
}

impl From<SkipAction> for SkipKind {
    fn from(a: SkipAction) -> Self {
        match a {
            SkipAction::Next => SkipKind::Next,
            SkipAction::Close => SkipKind::Close,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockEvent {
    pub id: u64,
    pub kind: EventKind,
    pub video_id: String,
    pub title: String,
    pub url: String,
    pub at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browser_name: Option<String>,
    /// Only for `skipped`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<SkipKind>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreData {
    #[serde(default)]
    pub version: u32,
    /// Newest block first.
    #[serde(default)]
    pub blocked: Vec<BlockedVideo>,
    /// Oldest first on disk; [`YoutubeBlockState::snapshot`] sends newest first.
    #[serde(default)]
    pub history: Vec<BlockEvent>,
    #[serde(default)]
    pub next_event_id: u64,
}

pub type Snapshot = StoreData;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── Store file ──────────────────────────────────────────────────────────────

fn tmp_path(path: &Path) -> PathBuf {
    crate::atomic_file::tmp_path(path)
}

fn backup_unusable(path: &Path) {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_else(|| FILE_NAME.into());
    name.push(format!(".bak-{}", now_ms()));
    let dest = path.with_file_name(name);
    match std::fs::rename(path, &dest) {
        Ok(()) => log::warn!("[youtube-block] unusable store moved to {}", dest.display()),
        Err(e) => log::warn!("[youtube-block] could not back up unusable store: {e}"),
    }
}

/// Missing file ⇒ empty. Corrupt or newer-than-us ⇒ moved aside, then empty.
fn load_from(path: &Path) -> StoreData {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return StoreData::default();
    };
    match serde_json::from_str::<StoreData>(&raw) {
        Ok(data) if data.version <= STORE_VERSION => data,
        _ => {
            backup_unusable(path);
            StoreData::default()
        }
    }
}

fn save_to(path: &Path, data: &StoreData) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
    }
    let json = serde_json::to_string_pretty(data).map_err(|e| format!("serialize: {e}"))?;
    crate::atomic_file::write_durable(path, &tmp_path(path), &json)
}

// ── Service ─────────────────────────────────────────────────────────────────

/// Retry bookkeeping for one tab that is showing a blocked video.
struct Guard {
    video_id: String,
    last: Instant,
    attempts: u32,
}

/// Managed state. `path` is `None` when no data dir was available: the blocker
/// still works for the session, it just does not persist.
pub struct YoutubeBlockState {
    data: Mutex<StoreData>,
    path: Option<PathBuf>,
    guards: Mutex<HashMap<(String, i64), Guard>>,
}

impl YoutubeBlockState {
    fn new(path: Option<PathBuf>) -> Self {
        let mut data = path.as_deref().map(load_from).unwrap_or_default();
        data.version = STORE_VERSION;
        Self {
            data: Mutex::new(data),
            path,
            guards: Mutex::new(HashMap::new()),
        }
    }

    fn persist(&self, data: &StoreData) {
        if let Some(path) = &self.path {
            if let Err(e) = save_to(path, data) {
                log::warn!("[youtube-block] save failed: {e}");
            }
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut snap = self.data.lock().map(|d| d.clone()).unwrap_or_default();
        snap.history.reverse();
        snap
    }

    fn find(&self, video_id: &str) -> Option<BlockedVideo> {
        self.data
            .lock()
            .ok()?
            .blocked
            .iter()
            .find(|b| b.video_id == video_id)
            .cloned()
    }

    fn push_event(data: &mut StoreData, mut event: BlockEvent) {
        event.id = data.next_event_id;
        data.next_event_id += 1;
        data.history.push(event);
        let excess = data.history.len().saturating_sub(MAX_EVENTS);
        if excess > 0 {
            data.history.drain(..excess);
        }
    }

    /// Block a video. Returns the entry and whether it was newly added.
    fn add(
        &self,
        video_id: &str,
        title: &str,
        browser_name: Option<String>,
    ) -> (BlockedVideo, bool) {
        let mut data = match self.data.lock() {
            Ok(d) => d,
            Err(p) => p.into_inner(),
        };
        if let Some(existing) = data.blocked.iter().find(|b| b.video_id == video_id) {
            return (existing.clone(), false);
        }
        let title = logic::clean_title(title);
        let video = BlockedVideo {
            video_id: video_id.to_string(),
            title: if title.is_empty() { video_id.to_string() } else { title },
            url: logic::watch_url(video_id),
            blocked_at_ms: now_ms(),
        };
        data.blocked.insert(0, video.clone());
        Self::push_event(
            &mut data,
            BlockEvent {
                id: 0,
                kind: EventKind::Blocked,
                video_id: video.video_id.clone(),
                title: video.title.clone(),
                url: video.url.clone(),
                at_ms: video.blocked_at_ms,
                browser_name,
                action: None,
            },
        );
        self.persist(&data);
        (video, true)
    }

    /// Unblock. `false` when the video was not blocked.
    fn remove(&self, video_id: &str) -> bool {
        let mut data = match self.data.lock() {
            Ok(d) => d,
            Err(p) => p.into_inner(),
        };
        let Some(pos) = data.blocked.iter().position(|b| b.video_id == video_id) else {
            return false;
        };
        let video = data.blocked.remove(pos);
        Self::push_event(
            &mut data,
            BlockEvent {
                id: 0,
                kind: EventKind::Unblocked,
                video_id: video.video_id,
                title: video.title,
                url: video.url,
                at_ms: now_ms(),
                browser_name: None,
                action: None,
            },
        );
        self.persist(&data);
        true
    }

    fn record_skip(
        &self,
        video: &BlockedVideo,
        title: &str,
        browser_name: &str,
        action: SkipAction,
    ) {
        let mut data = match self.data.lock() {
            Ok(d) => d,
            Err(p) => p.into_inner(),
        };
        let title = logic::clean_title(title);
        Self::push_event(
            &mut data,
            BlockEvent {
                id: 0,
                kind: EventKind::Skipped,
                video_id: video.video_id.clone(),
                title: if title.is_empty() { video.title.clone() } else { title },
                url: video.url.clone(),
                at_ms: now_ms(),
                browser_name: Some(browser_name.to_string()),
                action: Some(action.into()),
            },
        );
        self.persist(&data);
    }

    /// `"mine"` = what the user did (blocked/unblocked), `"skipped"` = what was
    /// skipped automatically, anything else = both. The blocked list itself is
    /// never touched.
    fn clear_history(&self, scope: &str) {
        let mut data = match self.data.lock() {
            Ok(d) => d,
            Err(p) => p.into_inner(),
        };
        data.history.retain(|e| {
            let is_skip = e.kind == EventKind::Skipped;
            match scope {
                "mine" => is_skip,
                "skipped" => !is_skip,
                _ => false,
            }
        });
        self.persist(&data);
    }

    /// Decide whether a tab showing a blocked video should be acted on now, and
    /// how. `None` while a previous command is still settling.
    fn plan_skip(
        &self,
        browser_id: &str,
        tab_id: i64,
        video_id: &str,
        can_next: bool,
    ) -> Option<SkipAction> {
        let mut guards = match self.guards.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if guards.len() > MAX_GUARDS {
            guards.clear();
        }
        let now = Instant::now();
        let key = (browser_id.to_string(), tab_id);
        let attempt = match guards.get_mut(&key) {
            Some(g) if g.video_id == video_id => {
                if now.duration_since(g.last).as_millis() < logic::SKIP_COOLDOWN_MS {
                    return None;
                }
                g.attempts += 1;
                g.last = now;
                g.attempts
            }
            _ => {
                guards.insert(
                    key,
                    Guard {
                        video_id: video_id.to_string(),
                        last: now,
                        attempts: 1,
                    },
                );
                1
            }
        };
        Some(logic::choose_action(can_next, attempt))
    }

    /// The tab is no longer on a blocked video — forget its retry state.
    fn clear_guard(&self, browser_id: &str, tab_id: i64) {
        if let Ok(mut guards) = self.guards.lock() {
            guards.remove(&(browser_id.to_string(), tab_id));
        }
    }
}

/// Register state. Never fails the app — a store problem degrades to an
/// in-memory blocker.
pub fn init(app: &mut tauri::App) {
    let path = app
        .handle()
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(FILE_NAME));
    if path.is_none() {
        log::warn!("[youtube-block] no app data dir — block list will not persist");
    }
    app.manage(YoutubeBlockState::new(path));
}

fn notify(app: &AppHandle, state: &YoutubeBlockState) {
    if let Err(e) = app.emit(EVT_CHANGED, state.snapshot()) {
        log::warn!("[youtube-block] emit failed: {e}");
    }
}

// ── Enforcement (needs the browser bridge — Windows only) ───────────────────

/// Check one browser's tabs and skip every blocked video that is not in focus.
/// Called by the bridge on each `full`/`delta`.
#[cfg(windows)]
pub fn enforce(
    app: &AppHandle,
    browser_id: &str,
    browser_name: &str,
    tabs: &[crate::browser_dto::BrowserTab],
    ws: &crate::browser_bridge::WsConnectionMap,
    queue: &crate::browser_tabs::BrowserCommandsQueue,
) {
    let Some(state) = app.try_state::<YoutubeBlockState>() else {
        return;
    };
    let mut changed = false;
    for tab in tabs {
        let blocked = logic::video_id(&tab.url).and_then(|id| state.find(&id).map(|v| (id, v)));
        let Some((video_id, video)) = blocked else {
            state.clear_guard(browser_id, tab.tab_id);
            continue;
        };
        // The one rule that must never bend: a tab being watched is left alone.
        if logic::in_focus(tab.active, tab.window_focused) {
            continue;
        }
        let can_next = tab.media.as_ref().is_some_and(|m| m.can_next);
        let Some(action) = state.plan_skip(browser_id, tab.tab_id, &video_id, can_next) else {
            continue;
        };
        let name = match action {
            SkipAction::Next => "next",
            SkipAction::Close => "closeTab",
        };
        crate::browser_tabs::enqueue_browser_command(
            queue,
            Some(ws),
            browser_id,
            tab.tab_id as i32,
            name,
            None,
        );
        let title = tab
            .media
            .as_ref()
            .map(|m| m.title.as_str())
            .filter(|t| !t.trim().is_empty())
            .unwrap_or(&tab.title);
        state.record_skip(&video, title, browser_name, action);
        changed = true;
    }
    if changed {
        notify(app, &state);
    }
}

/// Re-check every connected browser right now. Used after a new block so the
/// video is skipped at once instead of on the next tab change.
#[cfg(windows)]
fn enforce_everywhere(app: &AppHandle) {
    let (Some(slots), Some(queue), Some(ws)) = (
        app.try_state::<crate::browser_tabs::BrowserSlotsMap>(),
        app.try_state::<crate::browser_tabs::BrowserCommandsQueue>(),
        app.try_state::<crate::browser_bridge::WsConnectionMap>(),
    ) else {
        return;
    };
    let browsers: Vec<(String, String, Vec<crate::browser_dto::BrowserTab>)> = slots
        .lock()
        .map(|m| {
            m.values()
                .map(|s| (s.browser_id.clone(), s.browser_name.clone(), s.tabs.clone()))
                .collect()
        })
        .unwrap_or_default();
    for (id, name, tabs) in browsers {
        enforce(app, &id, &name, &tabs, &ws, &queue);
    }
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn youtube_block_get_state(state: State<'_, YoutubeBlockState>) -> Snapshot {
    state.snapshot()
}

/// Block the video at `url`. `title` is the tab's or player's title.
#[tauri::command]
pub fn youtube_block_add(
    app: AppHandle,
    state: State<'_, YoutubeBlockState>,
    url: String,
    title: Option<String>,
    browser_name: Option<String>,
) -> Result<BlockedVideo, String> {
    let video_id = logic::video_id(&url).ok_or_else(|| ERR_NOT_A_VIDEO.to_string())?;
    let (video, added) = state.add(&video_id, title.as_deref().unwrap_or(""), browser_name);
    if added {
        notify(&app, &state);
        #[cfg(windows)]
        enforce_everywhere(&app);
    }
    Ok(video)
}

#[tauri::command]
pub fn youtube_block_remove(
    app: AppHandle,
    state: State<'_, YoutubeBlockState>,
    video_id: String,
) -> bool {
    let removed = state.remove(&video_id);
    if removed {
        notify(&app, &state);
    }
    removed
}

/// Clear history entries: `scope` is `"mine"`, `"skipped"` or `"all"`.
#[tauri::command]
pub fn youtube_block_clear_history(
    app: AppHandle,
    state: State<'_, YoutubeBlockState>,
    scope: String,
) {
    state.clear_history(&scope);
    notify(&app, &state);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> YoutubeBlockState {
        YoutubeBlockState::new(None)
    }

    const ID: &str = "dQw4w9WgXcQ";

    #[test]
    fn add_is_idempotent_and_logs_once() {
        let s = state();
        let (v, added) = s.add(ID, "Song - YouTube", Some("Chrome".into()));
        assert!(added);
        assert_eq!(v.title, "Song");
        assert_eq!(v.url, logic::watch_url(ID));
        let (_, again) = s.add(ID, "Other", None);
        assert!(!again);
        let snap = s.snapshot();
        assert_eq!(snap.blocked.len(), 1);
        assert_eq!(snap.history.len(), 1);
        assert_eq!(snap.history[0].kind, EventKind::Blocked);
    }

    #[test]
    fn empty_title_falls_back_to_id() {
        let s = state();
        assert_eq!(s.add(ID, "  ", None).0.title, ID);
    }

    #[test]
    fn remove_logs_unblock_and_history_is_newest_first() {
        let s = state();
        s.add(ID, "Song", None);
        assert!(s.remove(ID));
        assert!(!s.remove(ID));
        let snap = s.snapshot();
        assert!(snap.blocked.is_empty());
        assert_eq!(snap.history[0].kind, EventKind::Unblocked);
        assert_eq!(snap.history[1].kind, EventKind::Blocked);
        assert!(snap.history[0].id > snap.history[1].id);
    }

    #[test]
    fn clear_scopes_leave_the_block_list_alone() {
        let s = state();
        let (v, _) = s.add(ID, "Song", None);
        s.record_skip(&v, "Song", "Chrome", SkipAction::Next);
        s.clear_history("skipped");
        let snap = s.snapshot();
        assert_eq!(snap.blocked.len(), 1);
        assert!(snap.history.iter().all(|e| e.kind != EventKind::Skipped));
        s.clear_history("mine");
        assert!(s.snapshot().history.is_empty());
        assert_eq!(s.snapshot().blocked.len(), 1);
    }

    #[test]
    fn history_is_capped() {
        let s = state();
        let (v, _) = s.add(ID, "Song", None);
        for _ in 0..(MAX_EVENTS + 50) {
            s.record_skip(&v, "Song", "Chrome", SkipAction::Next);
        }
        assert_eq!(s.snapshot().history.len(), MAX_EVENTS);
    }

    #[test]
    fn plan_skip_cools_down_then_escalates_to_close() {
        let s = state();
        assert_eq!(s.plan_skip("b", 1, ID, true), Some(SkipAction::Next));
        // Immediately again: still settling.
        assert_eq!(s.plan_skip("b", 1, ID, true), None);
        // A different tab is independent.
        assert_eq!(s.plan_skip("b", 2, ID, false), Some(SkipAction::Close));
        // A new video on the same tab restarts the count.
        assert_eq!(s.plan_skip("b", 1, "AAAAAAAAAAA", true), Some(SkipAction::Next));
        s.clear_guard("b", 1);
        assert_eq!(s.plan_skip("b", 1, ID, true), Some(SkipAction::Next));
    }

    #[test]
    fn persists_and_reloads() {
        let dir = std::env::temp_dir().join(format!("pilpod_yt_{}_{}", std::process::id(), now_ms()));
        let path = dir.join(FILE_NAME);
        {
            let s = YoutubeBlockState::new(Some(path.clone()));
            s.add(ID, "Song", None);
        }
        let s = YoutubeBlockState::new(Some(path));
        assert_eq!(s.snapshot().blocked.len(), 1);
        assert_eq!(s.snapshot().history.len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }
}
