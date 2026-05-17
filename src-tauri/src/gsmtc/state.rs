use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use tauri::{AppHandle, Emitter};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager,
    SessionsChangedEventArgs,
};

use super::mapping::{apply_extension_gsmtc_dedup, build_snapshot};
use super::audio_attach::enrich_snapshot_with_audio;
use crate::browser_tabs::{flatten_tabs, BrowserTabsMap};

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
    /// Per-browser tab data keyed by browserId. Use `browser_tabs::flatten_tabs` to read.
    pub browser_tabs: BrowserTabsMap,
    /// Set by every WinRT callback; consumed by the single debounce task.
    emit_dirty: AtomicBool,
    /// True while a debounce task is sleeping; guards against spawning duplicates.
    emit_scheduled: AtomicBool,
}

pub(crate) fn emit_fast_to_ui(app: &AppHandle, state: &Arc<GsmtcState>) {
    // Mark that fresh data is waiting. Any concurrent WinRT callbacks that
    // arrive while the debounce task is already sleeping will just flip the
    // flag and return — no extra WASAPI calls, no thundering herd.
    state.emit_dirty.store(true, Ordering::Relaxed);

    // Only one debounce task may be in flight at a time.
    if state.emit_scheduled.swap(true, Ordering::AcqRel) {
        return;
    }

    let app = app.clone();
    let state = Arc::clone(state);
    std::thread::Builder::new()
        .name("gsmtc-emit".into())
        .spawn(move || {
            // Trailing-edge: wait for the burst to settle before hitting WASAPI.
            std::thread::sleep(std::time::Duration::from_millis(80));
            state.emit_dirty.store(false, Ordering::Relaxed);

            let mut snap = build_snapshot(&state.manager, false);
            if let Ok(map) = state.browser_tabs.lock() {
                snap.browser_tabs = flatten_tabs(&map);
            }
            enrich_snapshot_with_audio(&mut snap);
            snap = apply_extension_gsmtc_dedup(snap);
            if let Err(e) = app.emit(EVT, snap) {
                eprintln!("[gsmtc] emit failed: {e}");
            }

            // Release the guard only after all work is done so a new burst
            // that arrives during the WASAPI call schedules its own task.
            state.emit_scheduled.store(false, Ordering::Release);
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
            emit_dirty: AtomicBool::new(false),
            emit_scheduled: AtomicBool::new(false),
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
        enrich_snapshot_with_audio(&mut snap);
        snap = apply_extension_gsmtc_dedup(snap);
        Ok(snap)
    }

    /// Find a session by its stable AUMID rather than its volatile list index.
    /// If multiple sessions share the same AUMID the first match is returned,
    /// which is the correct behaviour for the common single-instance case.
    pub fn session_by_aumid(
        &self,
        aumid: &str,
    ) -> Result<GlobalSystemMediaTransportControlsSession, String> {
        let sessions = self
            .manager
            .GetSessions()
            .map_err(|e| e.message().to_string())?;
        let n = sessions
            .Size()
            .map_err(|e| e.message().to_string())?;
        for i in 0..n {
            let session = sessions
                .GetAt(i)
                .map_err(|e| e.message().to_string())?;
            let id = session
                .SourceAppUserModelId()
                .map(|s| s.to_string())
                .unwrap_or_default();
            if id == aumid {
                return Ok(session);
            }
        }
        Err(format!("No session found with AUMID '{aumid}'"))
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
