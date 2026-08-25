//! Managed state for the floating widget: the in-memory source of truth, a
//! debounced writer, and the single broadcast point that keeps every window in
//! sync.
//!
//! ## Why Rust owns this
//!
//! The widget now lives in its own OS window, so two webviews care about the
//! same settings: the dashboard's menu (which edits them) and the widget
//! itself (which renders them). Neither can be authoritative without inventing
//! a cross-window sync protocol. Rust already has to know the placement to
//! position the window natively, so it holds the value and both webviews read
//! it — one writer, one event, no drift.
//!
//! ## Write discipline
//!
//! Dragging the widget fires a `Moved` event per frame. Persisting on each one
//! would be hundreds of file writes per gesture, so saves are coalesced on a
//! trailing edge: every mutation bumps a generation counter and arms a timer,
//! and only the timer that still owns the newest generation actually writes.
//! In-memory state updates immediately, so nothing user-visible waits on I/O.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use super::model::{self, WidgetPlacement, WidgetSettings, WidgetState};
use super::store;

/// Broadcast on every settings change. Payload is [`WidgetState`].
pub const STATE_EVENT: &str = "widget://state";

/// Trailing-edge window for coalescing saves. Long enough to swallow a whole
/// drag gesture, short enough that a crash right after a change is unlikely to
/// lose it.
const SAVE_DEBOUNCE: Duration = Duration::from_millis(700);

#[derive(Default)]
struct Inner {
    settings: WidgetSettings,
    /// Live-only: the widget's own settings panel is open, so the chip should
    /// be on screen *next to* the dashboard rather than yielding to it.
    ///
    /// Not persisted, and not part of [`WidgetState`] — nothing in either
    /// webview renders differently because of it. It only changes which window
    /// the native side shows, which is exactly the kind of thing that should
    /// not survive a restart.
    preview: bool,
    /// Resolved once at init; `None` before that (and in tests).
    path: Option<PathBuf>,
}

impl Inner {
    fn snapshot(&self) -> WidgetState {
        WidgetState {
            enabled: self.settings.enabled,
            placement: self.settings.placement,
            accent: self.settings.accent,
            size: self.settings.active_size(),
        }
    }
}

#[derive(Default)]
pub struct WidgetStore {
    inner: Mutex<Inner>,
    save_gen: AtomicU64,
    /// Last position *we* moved the window to; see [`WidgetStore::is_user_move`].
    applied_position: Mutex<Option<(i32, i32)>>,
}

impl WidgetStore {
    /// Read settings from disk into memory. Called once during app setup.
    pub fn hydrate(&self, app: &AppHandle) {
        let path = match store::store_path(app) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("[widget] no settings path ({e}) — running in-memory only");
                return;
            }
        };
        let mut loaded = store::load_from(&path);
        // Sizes read from disk have never been through the setter.
        loaded.size = model::clamp_size(loaded.size);
        loaded.free_size = model::clamp_size(loaded.free_size);
        if let Ok(mut inner) = self.inner.lock() {
            inner.settings = loaded;
            inner.path = Some(path);
        }
    }

    /// Current state as the frontend sees it.
    pub fn state(&self) -> WidgetState {
        match self.inner.lock() {
            Ok(inner) => inner.snapshot(),
            // A poisoned lock means another thread panicked mid-update. The
            // widget is cosmetic; report defaults rather than propagate.
            Err(_) => Inner::default().snapshot(),
        }
    }

    pub fn placement(&self) -> WidgetPlacement {
        self.state().placement
    }

    pub fn is_enabled(&self) -> bool {
        self.state().enabled
    }

    /// Chip edge length in logical pixels, already clamped, for whichever shape
    /// the current placement implies.
    pub fn chip_size(&self) -> f64 {
        self.state().size
    }

    /// Hold the chip on screen while its settings panel is open.
    ///
    /// Returns whether this changed anything, so the caller can skip a window
    /// round-trip for a repeated value.
    pub fn set_preview(&self, preview: bool) -> bool {
        match self.inner.lock() {
            Ok(mut inner) if inner.preview != preview => {
                inner.preview = preview;
                true
            }
            _ => false,
        }
    }

    pub fn is_preview(&self) -> bool {
        self.inner.lock().map(|i| i.preview).unwrap_or(false)
    }

    /// Mutate the persisted settings and return the resulting state.
    ///
    /// Returns `None` when the mutation was a no-op, which lets callers skip
    /// the save + broadcast entirely. That matters for `Moved`: the OS emits
    /// the event on show and on resize too, and re-broadcasting an unchanged
    /// position would bounce a render through every window for nothing.
    pub fn mutate(&self, f: impl FnOnce(&mut WidgetSettings)) -> Option<WidgetState> {
        let mut inner = self.inner.lock().ok()?;
        let before = inner.settings;
        f(&mut inner.settings);
        if inner.settings == before {
            return None;
        }
        Some(inner.snapshot())
    }

    /// Record the physical position we just moved the window to.
    pub fn note_applied_position(&self, x: i32, y: i32) {
        if let Ok(mut applied) = self.applied_position.lock() {
            *applied = Some((x, y));
        }
    }

    /// True when a `Moved` event reports somewhere we did not put the window —
    /// i.e. the user dragged it.
    ///
    /// This is a value check rather than a "we're busy" flag on purpose.
    /// Windows delivers `WM_MOVE` through the message queue, so the event for
    /// a `SetWindowPos` we made arrives *after* the call that caused it has
    /// returned. Any time-scoped guard would already be closed by then, and a
    /// corner snap or a resize would quietly re-record its own landing spot as
    /// a user drag. Comparing coordinates is immune to that ordering.
    pub fn is_user_move(&self, x: i32, y: i32) -> bool {
        match self.applied_position.lock() {
            Ok(applied) => *applied != Some((x, y)),
            Err(_) => true,
        }
    }

    /// Arm the trailing-edge save timer. Cheap and safe to call on every
    /// mutation, including per-frame drag updates.
    pub fn schedule_save(&self, app: &AppHandle) {
        let generation = self.save_gen.fetch_add(1, Ordering::SeqCst) + 1;
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(SAVE_DEBOUNCE);
            let store = app.state::<WidgetStore>();
            // A newer mutation armed its own timer; let that one do the write.
            if store.save_gen.load(Ordering::SeqCst) != generation {
                return;
            }
            store.save_now();
        });
    }

    /// Write immediately, bypassing the debounce. Used on app exit so a change
    /// made in the last few hundred milliseconds is not lost.
    pub fn save_now(&self) {
        let Ok(inner) = self.inner.lock() else { return };
        let Some(path) = inner.path.clone() else {
            return;
        };
        let settings = inner.settings;
        drop(inner);
        if let Err(e) = store::save_to(&path, &settings) {
            log::warn!("[widget] settings save failed: {e}");
        }
    }
}

/// Broadcast the current state to every window (dashboard menu + widget).
pub fn emit_state(app: &AppHandle, state: WidgetState) {
    if let Err(e) = app.emit(STATE_EVENT, state) {
        log::warn!("[widget] state emit failed: {e}");
    }
}

/// Persist + broadcast in one call — the tail of every settings command.
pub fn commit(app: &AppHandle, store: &WidgetStore, state: WidgetState) {
    store.schedule_save(app);
    emit_state(app, state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::widget::model::WidgetCorner;

    #[test]
    fn mutate_reports_none_for_a_no_op() {
        let store = WidgetStore::default();
        assert!(store.mutate(|s| s.enabled = false).is_none());
        assert!(store.mutate(|s| s.enabled = true).is_some());
        assert!(store.mutate(|s| s.enabled = true).is_none());
    }

    #[test]
    fn mutate_returns_the_new_state() {
        let store = WidgetStore::default();
        let state = store
            .mutate(|s| {
                s.enabled = true;
                s.placement = WidgetPlacement::Corner {
                    corner: WidgetCorner::TopLeft,
                };
            })
            .expect("changed");
        assert!(state.enabled);
        assert_eq!(
            state.placement,
            WidgetPlacement::Corner {
                corner: WidgetCorner::TopLeft
            }
        );
    }

    #[test]
    fn size_from_disk_is_clamped_on_read() {
        let store = WidgetStore::default();
        store.mutate(|s| s.size = 5_000.0);
        assert_eq!(store.chip_size(), crate::widget::model::CHIP_MAX_PX);
    }

    #[test]
    fn the_reported_size_follows_the_placement() {
        let store = WidgetStore::default();
        assert_eq!(store.chip_size(), crate::widget::model::CHIP_DEFAULT_PX);

        let free = store
            .mutate(|s| s.placement = WidgetPlacement::Free { x: 0.0, y: 0.0 })
            .expect("changed");
        assert_eq!(free.size, crate::widget::model::CHIP_FREE_DEFAULT_PX);
        assert_eq!(store.chip_size(), crate::widget::model::CHIP_FREE_DEFAULT_PX);
    }

    #[test]
    fn preview_is_live_only_and_deduped() {
        let store = WidgetStore::default();
        assert!(!store.is_preview());
        assert!(store.set_preview(true));
        assert!(!store.set_preview(true));
        assert!(store.is_preview());
        assert!(store.set_preview(false));
    }

    #[test]
    fn only_positions_we_did_not_apply_count_as_user_moves() {
        let store = WidgetStore::default();
        // Nothing applied yet: any report is the user (or the OS placing it).
        assert!(store.is_user_move(10, 20));

        store.note_applied_position(10, 20);
        // The echo of our own SetWindowPos, arriving late off the message
        // queue — must not be recorded as a drag.
        assert!(!store.is_user_move(10, 20));
        // A real drag away from where we put it.
        assert!(store.is_user_move(11, 20));

        // A corner snap moves the window again; the new position becomes the
        // reference, so the *old* one is no longer treated as ours.
        store.note_applied_position(300, 400);
        assert!(!store.is_user_move(300, 400));
        assert!(store.is_user_move(10, 20));
    }

    #[test]
    fn save_without_a_path_is_a_no_op_not_a_panic() {
        let store = WidgetStore::default();
        store.mutate(|s| s.enabled = true);
        store.save_now();
    }
}
