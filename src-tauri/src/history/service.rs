//! The history service: owns the recorder and the store and decides when they
//! talk. Tauri-free, so the locking and failure handling are unit-testable.
//!
//! Locking rule — **always `store` before `recorder`**:
//!   * [`HistoryService::observe`] takes only the recorder. It runs on the
//!     thread that emitted `browsers://update` and must never wait on disk.
//!   * Everything that writes takes the store first, then the recorder. That
//!     ordering is what guarantees a delete cannot interleave with a flush of
//!     the very row being deleted (which would quietly resurrect it).

use std::sync::{Mutex, MutexGuard};

use super::model::{
    HistoryKind, HistoryPage, HistoryQuery, HistorySettings, MediaPlay, PageVisit,
    MAX_RETENTION_DAYS,
};
use super::recorder::{BrowserObservation, Recorder, RecorderSeed, RESUME_WINDOW_MS};
use super::store::HistoryStore;

/// How often "PilPod is alive" is recorded — the end time given to rows a
/// crash left open.
const HEARTBEAT_MS: i64 = 30_000;
const PURGE_EVERY_MS: i64 = 60 * 60 * 1000;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

pub const ERR_INVALID_RETENTION: &str = "invalid_retention";

struct Housekeeping {
    last_heartbeat_ms: i64,
    last_purge_ms: i64,
}

pub struct HistoryService {
    store: Mutex<HistoryStore>,
    recorder: Mutex<Recorder>,
    settings: Mutex<HistorySettings>,
    housekeeping: Mutex<Housekeeping>,
}

/// Recover from poisoning: every critical section here leaves its data valid
/// at each step, so a panic elsewhere is no reason to stop recording.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl HistoryService {
    /// Bring a store online: close rows a crash left open, seed the recorder,
    /// apply retention once.
    pub fn start(mut store: HistoryStore, now: i64) -> Result<Self, String> {
        let last_alive = store.last_alive()?.unwrap_or(now).min(now);
        let repaired = store.close_dangling(last_alive)?;
        if repaired > 0 {
            log::info!("[history] closed {repaired} row(s) left open by an unclean exit");
        }

        let settings = store.settings()?;
        let (next_visit_id, next_play_id) = store.next_ids()?;
        let resumable = store.resumable_since(now - RESUME_WINDOW_MS)?;
        let recorder = Recorder::new(
            RecorderSeed {
                next_visit_id,
                next_play_id,
                resumable,
            },
            settings.recording,
        );

        let service = Self {
            store: Mutex::new(store),
            recorder: Mutex::new(recorder),
            settings: Mutex::new(settings),
            housekeeping: Mutex::new(Housekeeping {
                last_heartbeat_ms: i64::MIN,
                last_purge_ms: i64::MIN,
            }),
        };
        service.tick(now)?;
        Ok(service)
    }

    /// Feed one complete snapshot of the recordable browsers. Memory only.
    pub fn observe<'a>(
        &self,
        now: i64,
        browsers: impl IntoIterator<Item = BrowserObservation<'a>>,
    ) {
        lock(&self.recorder).observe(now, browsers);
    }

    /// Periodic work: sweep, flush staged rows, heartbeat, retention.
    /// Returns `true` when stored history changed (the UI should refresh).
    pub fn tick(&self, now: i64) -> Result<bool, String> {
        let mut store = lock(&self.store);
        let writes = {
            let mut recorder = lock(&self.recorder);
            recorder.sweep(now);
            recorder.take_writes()
        };
        let mut changed = false;
        if !writes.is_empty() {
            if let Err(e) = store.apply(&writes) {
                // Keep the rows; the next tick retries them.
                lock(&self.recorder).restore_writes(writes);
                return Err(e);
            }
            changed = true;
        }

        let mut housekeeping = lock(&self.housekeeping);
        if now.saturating_sub(housekeeping.last_heartbeat_ms) >= HEARTBEAT_MS {
            store.set_last_alive(now)?;
            housekeeping.last_heartbeat_ms = now;
        }
        if now.saturating_sub(housekeeping.last_purge_ms) >= PURGE_EVERY_MS {
            changed |= self.purge(&mut store, now)? > 0;
            housekeeping.last_purge_ms = now;
        }
        Ok(changed)
    }

    /// PilPod is exiting: end every open row and write it out now.
    pub fn shutdown(&self, now: i64) -> Result<(), String> {
        let mut store = lock(&self.store);
        let writes = {
            let mut recorder = lock(&self.recorder);
            recorder.shutdown(now);
            recorder.take_writes()
        };
        store.apply(&writes)?;
        store.set_last_alive(now)
    }

    // ── Settings ───────────────────────────────────────────────────────────

    pub fn settings(&self) -> HistorySettings {
        *lock(&self.settings)
    }

    pub fn update_settings(
        &self,
        next: HistorySettings,
        now: i64,
    ) -> Result<HistorySettings, String> {
        if next.retention_days > MAX_RETENTION_DAYS {
            return Err(ERR_INVALID_RETENTION.into());
        }
        let mut store = lock(&self.store);
        store.save_settings(&next)?;
        let previous = std::mem::replace(&mut *lock(&self.settings), next);

        // Pausing ends whatever is open; persist that now rather than a tick later.
        let writes = {
            let mut recorder = lock(&self.recorder);
            recorder.set_enabled(next.recording, now);
            recorder.take_writes()
        };
        if let Err(e) = store.apply(&writes) {
            lock(&self.recorder).restore_writes(writes);
            return Err(e);
        }
        if next.retention_days != previous.retention_days {
            self.purge(&mut store, now)?;
        }
        Ok(next)
    }

    // ── Reads ──────────────────────────────────────────────────────────────

    pub fn query_pages(&self, query: &HistoryQuery) -> Result<HistoryPage<PageVisit>, String> {
        lock(&self.store).query_pages(query)
    }

    pub fn query_media(&self, query: &HistoryQuery) -> Result<HistoryPage<MediaPlay>, String> {
        lock(&self.store).query_media(query)
    }

    // ── Deletes ────────────────────────────────────────────────────────────

    pub fn delete(&self, kind: HistoryKind, ids: &[i64]) -> Result<usize, String> {
        let mut store = lock(&self.store);
        lock(&self.recorder).forget(kind, ids);
        store.delete(kind, ids)
    }

    pub fn clear(
        &self,
        kind: Option<HistoryKind>,
        from: Option<i64>,
        to: Option<i64>,
    ) -> Result<usize, String> {
        let mut store = lock(&self.store);
        lock(&self.recorder).forget_range(kind, from, to);
        store.clear(kind, from, to)
    }

    fn purge(&self, store: &mut HistoryStore, now: i64) -> Result<usize, String> {
        let days = self.settings().retention_days;
        if days == 0 {
            return Ok(0);
        }
        let removed = store.purge_ended_before(now - i64::from(days) * DAY_MS)?;
        if removed > 0 {
            log::info!("[history] retention: removed {removed} row(s) older than {days} day(s)");
        }
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser_dto::BrowserTab;
    use crate::history::recorder::MIN_PLAY_MS;

    const S: i64 = 1_000;

    fn tab(tab_id: i64, url: &str, title: &str) -> BrowserTab {
        BrowserTab {
            tab_id,
            url: url.into(),
            title: title.into(),
            ..Default::default()
        }
    }

    fn chrome(tabs: &[BrowserTab]) -> [BrowserObservation<'_>; 1] {
        [BrowserObservation {
            browser_id: "p1",
            os_browser_id: "chrome",
            browser_name: "Chrome",
            tabs,
        }]
    }

    fn pages(service: &HistoryService) -> Vec<PageVisit> {
        service.query_pages(&HistoryQuery::default()).unwrap().items
    }

    fn service(now: i64) -> HistoryService {
        HistoryService::start(HistoryStore::open_in_memory().unwrap(), now).unwrap()
    }

    #[test]
    fn observed_tabs_reach_the_store_on_tick() {
        let s = service(0);
        s.observe(S, chrome(&[tab(1, "https://a.com", "A")]));
        assert!(pages(&s).is_empty(), "observing never writes");
        assert!(s.tick(2 * S).unwrap());
        assert_eq!(pages(&s).len(), 1);
        assert!(!s.tick(3 * S).unwrap(), "nothing new");
    }

    #[test]
    fn deleted_open_visit_does_not_come_back() {
        let s = service(0);
        s.observe(S, chrome(&[tab(1, "https://a.com", "A")]));
        s.tick(2 * S).unwrap();
        let id = pages(&s)[0].id;
        assert_eq!(s.delete(HistoryKind::Pages, &[id]).unwrap(), 1);
        s.observe(3 * S, chrome(&[tab(1, "https://a.com", "A (1)")]));
        s.tick(4 * S).unwrap();
        s.shutdown(5 * S).unwrap();
        assert!(pages(&s).is_empty());
    }

    #[test]
    fn clearing_everything_also_drops_unflushed_rows() {
        let s = service(0);
        s.observe(S, chrome(&[tab(1, "https://a.com", "A")]));
        s.clear(None, None, None).unwrap();
        s.tick(2 * S).unwrap();
        assert!(pages(&s).is_empty());
    }

    #[test]
    fn pausing_closes_open_rows_immediately_and_stops_recording() {
        let s = service(0);
        s.observe(S, chrome(&[tab(1, "https://a.com", "A")]));
        s.tick(2 * S).unwrap();
        s.update_settings(
            HistorySettings {
                recording: false,
                retention_days: 90,
            },
            3 * S,
        )
        .unwrap();
        assert_eq!(pages(&s)[0].ended_at_ms, Some(3 * S));
        s.observe(4 * S, chrome(&[tab(1, "https://b.com", "B")]));
        s.tick(5 * S).unwrap();
        assert_eq!(pages(&s).len(), 1);
        assert!(!s.settings().recording);
    }

    #[test]
    fn retention_is_validated_and_applied() {
        let s = service(0);
        let bad = HistorySettings {
            recording: true,
            retention_days: MAX_RETENTION_DAYS + 1,
        };
        assert_eq!(
            s.update_settings(bad, 0).unwrap_err(),
            ERR_INVALID_RETENTION
        );

        s.observe(0, chrome(&[tab(1, "https://old.com", "Old")]));
        s.observe(S, chrome(&[tab(99, "chrome://newtab/", "")]));
        s.tick(2 * S).unwrap();
        let later = 40 * DAY_MS;
        s.update_settings(
            HistorySettings {
                recording: true,
                retention_days: 30,
            },
            later,
        )
        .unwrap();
        assert!(pages(&s).is_empty());
    }

    #[test]
    fn restart_after_a_crash_closes_and_resumes_rows() {
        let path = std::env::temp_dir().join(format!(
            "pilpod_history_service_{}_{}.sqlite3",
            std::process::id(),
            super::super::now_ms()
        ));
        {
            let s = HistoryService::start(HistoryStore::open(&path).unwrap(), 0).unwrap();
            s.observe(S, chrome(&[tab(1, "https://a.com", "A")]));
            s.tick(HEARTBEAT_MS).unwrap(); // flush + heartbeat at 30 s
                                           // …and the process dies without `shutdown`.
        }
        let s = HistoryService::start(HistoryStore::open(&path).unwrap(), 600 * S).unwrap();
        let row = pages(&s).remove(0);
        assert_eq!(
            row.ended_at_ms,
            Some(HEARTBEAT_MS),
            "ended at the last heartbeat"
        );

        // The tab is still open: same row continues.
        s.observe(601 * S, chrome(&[tab(5, "https://a.com", "A")]));
        s.tick(602 * S).unwrap();
        let rows = pages(&s);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, row.id);
        assert_eq!(rows[0].ended_at_ms, None);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn media_plays_are_flushed_once_they_qualify() {
        let s = service(0);
        let mut media = tab(1, "https://yt.com/w?v=1", "Video");
        let mut m: crate::browser_dto::TabMedia = serde_json::from_str("{}").unwrap();
        m.title = "Video".into();
        m.playback_state = "playing".into();
        media.media = Some(m);
        s.observe(0, chrome(&[media]));
        s.tick(MIN_PLAY_MS).unwrap();
        let plays = s.query_media(&HistoryQuery::default()).unwrap().items;
        assert_eq!(plays.len(), 1);
        assert_eq!(plays[0].played_ms, MIN_PLAY_MS);
    }
}
