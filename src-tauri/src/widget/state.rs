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
    /// Live-only: whether the widget window is showing the expanded panel.
    /// Deliberately not persisted — see [`WidgetSettings`].
    expanded: bool,
    /// Live-only: whether the expanded panel also shows the full browser list.
    /// Resets with every collapse, so the panel always opens on what matters.
    browsers_open: bool,
    /// Resolved once at init; `None` before that (and in tests).
    path: Option<PathBuf>,
}

impl Inner {
    fn snapshot(&self) -> WidgetState {
        WidgetState {
            enabled: self.settings.enabled,
            placement: self.settings.placement,
            accent: self.settings.accent,
            size: self.settings.size,
            expanded: self.expanded,
            browsers_open: self.browsers_open,
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
        // A size read from disk has never been through the setter.
        loaded.size = model::clamp_size(loaded.size);
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

    /// Chip edge length in logical pixels, already clamped.
    pub fn chip_size(&self) -> f64 {
        model::clamp_size(self.state().size)
    }

    pub fn browsers_open(&self) -> bool {
        self.state().browsers_open
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

    /// Set the live expanded flag. Not persisted, so no save is scheduled.
    ///
    /// Collapsing also closes the browser list: the panel should always open
    /// on what is playing, and re-opening into a 600px list the user expanded
    /// once, days ago, is not what they meant.
    pub fn set_expanded(&self, expanded: bool) -> Option<WidgetState> {
        let mut inner = self.inner.lock().ok()?;
        if inner.expanded == expanded {
            return None;
        }
        inner.expanded = expanded;
        if !expanded {
            inner.browsers_open = false;
        }
        Some(inner.snapshot())
    }

    /// Show or hide the full browser list inside the expanded panel.
    pub fn set_browsers_open(&self, open: bool) -> Option<WidgetState> {
        let mut inner = self.inner.lock().ok()?;
        if inner.browsers_open == open {
            return None;
        }
        inner.browsers_open = open;
        Some(inner.snapshot())
    }

    pub fn is_expanded(&self) -> bool {
        self.inner.lock().map(|i| i.expanded).unwrap_or(false)
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
    /// returned. Any time-scoped guard would already be closed by then, and
    /// expanding the panel would quietly overwrite the chip's saved position
    /// with the panel's. Comparing coordinates is immune to that ordering.
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
        assert!(!state.expanded);
    }

    #[test]
    fn expanded_is_live_only_and_deduped() {
        let store = WidgetStore::default();
        assert!(store.set_expanded(false).is_none());
        assert!(store.set_expanded(true).expect("changed").expanded);
        assert!(store.set_expanded(true).is_none());
        assert!(store.is_expanded());
    }

    #[test]
    fn collapsing_also_closes_the_browser_list() {
        let store = WidgetStore::default();
        store.set_expanded(true);
        assert!(store.set_browsers_open(true).expect("changed").browsers_open);

        let collapsed = store.set_expanded(false).expect("changed");
        assert!(!collapsed.expanded);
        assert!(!collapsed.browsers_open);

        // Re-opening starts on the now-playing view again.
        assert!(!store.set_expanded(true).expect("changed").browsers_open);
    }

    #[test]
    fn size_from_disk_is_clamped_on_read() {
        let store = WidgetStore::default();
        store.mutate(|s| s.size = 5_000.0);
        assert_eq!(store.chip_size(), crate::widget::model::CHIP_MAX_PX);
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

        // Expanding moves the window again; the new position becomes the
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
