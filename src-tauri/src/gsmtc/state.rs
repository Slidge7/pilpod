use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    SessionsChangedEventArgs,
};

use super::mapping::build_snapshot;
use crate::browser_bridge::{flatten_tabs, BrowserTabsMap};

const EVT: &str = "gsmtc://update";

struct SessionHooks {
    session: GlobalSystemMediaTransportControlsSession,
    playback_token: i64,
    media_token: i64,
    timeline_token: i64,
}

struct GsmtcInner {
    sessions_changed_token: i64,
    session_hooks: Vec<SessionHooks>,
}

pub struct GsmtcState {
    pub manager: GlobalSystemMediaTransportControlsSessionManager,
    inner: Mutex<GsmtcInner>,
    /// Per-browser tab data keyed by browserId. Use browser_bridge::flatten_tabs to read.
    pub browser_tabs: BrowserTabsMap,
}

pub(crate) fn emit_fast_to_ui(app: &AppHandle, state: &Arc<GsmtcState>) {
    // Build snapshot + emit on a worker thread so we never block the STA / WinRT
    // callback thread. `emit` in Tauri 2 is Send-safe.
    let app = app.clone();
    let state = Arc::clone(state);
    std::thread::Builder::new()
        .name("gsmtc-emit".into())
        .spawn(move || {
            let mut snap = build_snapshot(&state.manager, false);
            if let Ok(map) = state.browser_tabs.lock() {
                snap.browser_tabs = flatten_tabs(&map);
            }
            if let Err(e) = app.emit(EVT, snap) {
                eprintln!("[gsmtc] emit failed: {e}");
            }
        })
        .ok();
}

fn clear_session_hooks(hooks: Vec<SessionHooks>) {
    for h in hooks {
        let _ = h.session.RemovePlaybackInfoChanged(h.playback_token);
        let _ = h.session.RemoveMediaPropertiesChanged(h.media_token);
        let _ = h.session.RemoveTimelinePropertiesChanged(h.timeline_token);
    }
}

impl GsmtcState {
    pub fn create(
        app: AppHandle,
        browser_tabs: BrowserTabsMap,
    ) -> windows::core::Result<Arc<Self>> {
        eprintln!("[gsmtc] requesting manager...");
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
        eprintln!("[gsmtc] manager ready");
        let state = Arc::new(Self {
            manager: manager.clone(),
            inner: Mutex::new(GsmtcInner {
                sessions_changed_token: 0,
                session_hooks: Vec::new(),
            }),
            browser_tabs,
        });

        let arc_for_sessions = Arc::clone(&state);
        let app_for_sessions = app.clone();
        let token = manager.SessionsChanged(&TypedEventHandler::new(
            move |_sender, _args: windows::core::Ref<'_, SessionsChangedEventArgs>| {
                if let Err(e) = arc_for_sessions.resubscribe(&app_for_sessions) {
                    eprintln!("gsmtc resubscribe: {e}");
                }
                Ok(())
            },
        ))?;

        {
            let mut g = state.inner.lock().expect("gsmtc mutex poisoned");
            g.sessions_changed_token = token;
        }

        if let Err(e) = state.resubscribe(&app) {
            eprintln!("gsmtc initial subscribe: {e}");
        }
        emit_fast_to_ui(&app, &state);

        Ok(state)
    }

    fn resubscribe(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        eprintln!("[gsmtc] resubscribe begin");
        let old_hooks = {
            let mut g = self.inner.lock().map_err(|_| "mutex poisoned")?;
            std::mem::take(&mut g.session_hooks)
        };
        clear_session_hooks(old_hooks);

        let sessions = self
            .manager
            .GetSessions()
            .map_err(|e| e.message().to_string())?;
        let n = sessions
            .Size()
            .map_err(|e| e.message().to_string())?;

        let mut hooks = Vec::new();
        for i in 0..n {
            let session = sessions
                .GetAt(i)
                .map_err(|e| e.message().to_string())?;
            let me = Arc::clone(self);
            let app_p = app.clone();
            let t_play = session
                .PlaybackInfoChanged(&TypedEventHandler::new(
                    move |_s, _a: windows::core::Ref<'_, windows::Media::Control::PlaybackInfoChangedEventArgs>| {
                        emit_fast_to_ui(&app_p, &me);
                        Ok(())
                    },
                ))
                .map_err(|e| e.message().to_string())?;

            let me = Arc::clone(self);
            let app_m = app.clone();
            let t_media = session
                .MediaPropertiesChanged(&TypedEventHandler::new(
                    move |_s, _a: windows::core::Ref<'_, windows::Media::Control::MediaPropertiesChangedEventArgs>| {
                        emit_fast_to_ui(&app_m, &me);
                        Ok(())
                    },
                ))
                .map_err(|e| e.message().to_string())?;

            let me = Arc::clone(self);
            let app_t = app.clone();
            let t_timeline = session
                .TimelinePropertiesChanged(&TypedEventHandler::new(
                    move |_s, _a: windows::core::Ref<'_, windows::Media::Control::TimelinePropertiesChangedEventArgs>| {
                        emit_fast_to_ui(&app_t, &me);
                        Ok(())
                    },
                ))
                .map_err(|e| e.message().to_string())?;

            hooks.push(SessionHooks {
                session,
                playback_token: t_play,
                media_token: t_media,
                timeline_token: t_timeline,
            });
        }

        {
            let mut g = self.inner.lock().map_err(|_| "mutex poisoned")?;
            g.session_hooks = hooks;
        }
        eprintln!("[gsmtc] resubscribe done ({n} sessions)");
        emit_fast_to_ui(app, self);
        Ok(())
    }

    pub fn snapshot(&self) -> Result<super::dto::GsmtcSnapshot, String> {
        let mut snap = build_snapshot(&self.manager, true);
        snap.browser_tabs = self
            .browser_tabs
            .lock()
            .map(|map| flatten_tabs(&map))
            .unwrap_or_default();
        Ok(snap)
    }

    pub fn session_at_index(
        &self,
        session_index: u32,
    ) -> Result<GlobalSystemMediaTransportControlsSession, String> {
        let sessions = self
            .manager
            .GetSessions()
            .map_err(|e| e.message().to_string())?;
        let n = sessions
            .Size()
            .map_err(|e| e.message().to_string())?;
        if session_index >= n {
            return Err(format!(
                "No session at index {session_index} (session count: {n})"
            ));
        }
        sessions
            .GetAt(session_index)
            .map_err(|e| e.message().to_string())
    }
}

impl Drop for GsmtcState {
    fn drop(&mut self) {
        let Ok(mut g) = self.inner.lock() else {
            return;
        };
        let sessions_changed_token = g.sessions_changed_token;
        let hooks = std::mem::take(&mut g.session_hooks);
        drop(g);
        clear_session_hooks(hooks);
        let _ = self
            .manager
            .RemoveSessionsChanged(sessions_changed_token);
    }
}
