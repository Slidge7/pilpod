//! The recorder: turns successive browser snapshots into history rows.
//!
//! A pure state machine — no I/O, no clock, no Tauri. Every method takes `now`
//! (wall-clock ms) so the whole lifecycle is unit-testable with plain integers.
//! The service feeds it the same browser list the dashboard renders and drains
//! the rows it produces into the store.
//!
//! ## What a snapshot means
//!
//! Each [`Recorder::observe`] call is the *complete* set of recordable
//! browsers. Anything the recorder holds open that is missing from it is
//! resolved one of two ways:
//!
//! * **its browser is present, the tab is not** — the tab was closed. The
//!   visit / play ends right now.
//! * **its browser is absent** — the extension disconnected (browser closed,
//!   machine asleep, socket blip). The session is parked for
//!   [`MISSING_GRACE_MS`]; if the browser comes back in time nothing happened,
//!   otherwise [`Recorder::sweep`] ends it at the moment it went missing.
//!
//! A browser reporting zero tabs counts as absent: a real browser always has
//! at least one, so an empty list is a connection still handshaking.
//!
//! ## Resuming instead of duplicating
//!
//! A visit that ended because its *browser* went away (or PilPod exited) is
//! "resumable". When that browser profile next *arrives* — its first snapshot
//! after being absent — any of its tabs on the same URL continue that row
//! instead of inserting a new one. This is what stops every restart of PilPod,
//! or of a browser that restores its session, from re-listing every open tab
//! as a fresh visit. Only the arrival snapshot may resume: a page the user
//! opens afterwards is a new visit, even if it was open yesterday. Leftovers
//! the arrival did not claim are settled as ordinary closed rows.
//!
//! ## Writes
//!
//! Rows are staged in per-kind maps keyed by id, so a burst of title changes
//! coalesces into one upsert. The service drains them with
//! [`Recorder::take_writes`] on its own thread; observing never touches disk.

use std::collections::{BTreeMap, HashMap, HashSet};

use super::model::{HistoryKind, MediaPlay, PageVisit};
use crate::browser_dto::{BrowserTab, TabMedia};

/// How long a session whose browser vanished is held open before it ends.
pub const MISSING_GRACE_MS: i64 = 20_000;
/// How long after its browser left a visit may still be resumed (covers a
/// browser left closed over a long weekend).
pub const RESUME_WINDOW_MS: i64 = 7 * 24 * 60 * 60 * 1000;
/// Media must play this long before it is worth a history row.
pub const MIN_PLAY_MS: i64 = 10_000;
/// While media keeps playing, its played time is re-saved this often so a
/// crash loses at most this much of it.
pub const PLAY_CHECKPOINT_MS: i64 = 60_000;

const MAX_URL_LEN: usize = 2048;
const MAX_TEXT_LEN: usize = 300;

/// One recordable browser profile in a snapshot.
#[derive(Debug, Clone, Copy)]
pub struct BrowserObservation<'a> {
    pub browser_id: &'a str,
    pub os_browser_id: &'a str,
    pub browser_name: &'a str,
    pub tabs: &'a [BrowserTab],
}

/// A row for the store to upsert (insert, or replace by id).
#[derive(Debug, Clone, PartialEq)]
pub enum HistoryWrite {
    /// `resumable` marks a visit that ended because its browser went away.
    Visit {
        visit: PageVisit,
        resumable: bool,
    },
    Play(MediaPlay),
}

/// Where a fresh recorder starts: id counters past the stored rows, and the
/// visits it may pick back up.
#[derive(Debug, Default)]
pub struct RecorderSeed {
    pub next_visit_id: i64,
    pub next_play_id: i64,
    pub resumable: Vec<PageVisit>,
}

/// `(browser_id, tab_id)` — tab ids are only unique within one browser.
type TabKey = (String, i64);
/// `(browser_id, url)` — tab ids do not survive a browser restart; URLs do.
type ResumeKey = (String, String);

struct OpenVisit {
    visit: PageVisit,
    /// `false` once the user deleted this row: keep tracking, stop writing.
    persist: bool,
    missing_since: Option<i64>,
}

struct OpenPlay {
    /// `played_ms` here excludes the segment currently running.
    play: MediaPlay,
    persist: bool,
    playing_since: Option<i64>,
    missing_since: Option<i64>,
    /// Played time of the last row handed to the store; `None` = never stored.
    written_played_ms: Option<i64>,
}

impl OpenPlay {
    fn played_at(&self, now: i64) -> i64 {
        self.play.played_ms + self.playing_since.map_or(0, |since| (now - since).max(0))
    }

    /// Fold the running segment into `played_ms` and stop the clock.
    fn settle(&mut self, at: i64) {
        if let Some(since) = self.playing_since.take() {
            self.play.played_ms += (at - since).max(0);
        }
    }

    fn is_same_media(&self, id: &MediaIdentity) -> bool {
        self.play.url == id.url && self.play.title == id.title && self.play.artist == id.artist
    }
}

/// What makes two media observations "the same play". A Spotify-style page
/// keeps its URL across tracks, so the title and artist are part of it.
struct MediaIdentity {
    url: String,
    title: String,
    artist: Option<String>,
}

pub struct Recorder {
    enabled: bool,
    next_visit_id: i64,
    next_play_id: i64,
    visits: HashMap<TabKey, OpenVisit>,
    plays: HashMap<TabKey, OpenPlay>,
    resumable: HashMap<ResumeKey, PageVisit>,
    /// Browsers present in the previous snapshot — a browser missing from
    /// this set is *arriving*, and only an arrival may resume visits.
    present: HashSet<String>,
    pending_visits: BTreeMap<i64, (PageVisit, bool)>,
    pending_plays: BTreeMap<i64, MediaPlay>,
}

impl Recorder {
    pub fn new(seed: RecorderSeed, enabled: bool) -> Self {
        let resumable = seed
            .resumable
            .into_iter()
            .map(|v| ((v.browser_id.clone(), v.url.clone()), v))
            .collect();
        Self {
            enabled,
            next_visit_id: seed.next_visit_id.max(1),
            next_play_id: seed.next_play_id.max(1),
            visits: HashMap::new(),
            plays: HashMap::new(),
            resumable,
            present: HashSet::new(),
            pending_visits: BTreeMap::new(),
            pending_plays: BTreeMap::new(),
        }
    }

    /// Pausing closes everything that is open — nothing is recorded while
    /// paused, and resuming starts clean rather than stitching across the gap.
    pub fn set_enabled(&mut self, enabled: bool, now: i64) {
        if self.enabled == enabled {
            return;
        }
        if !enabled {
            self.close_everything(now, false);
            self.resumable.clear();
            self.present.clear();
        }
        self.enabled = enabled;
    }

    /// Reconcile open sessions against a complete snapshot of the recordable
    /// browsers. See the module docs for how absent tabs are resolved.
    pub fn observe<'a>(
        &mut self,
        now: i64,
        browsers: impl IntoIterator<Item = BrowserObservation<'a>>,
    ) {
        if !self.enabled {
            return;
        }
        let mut live_browsers: HashSet<String> = HashSet::new();
        let mut live_tabs: HashSet<TabKey> = HashSet::new();
        for browser in browsers {
            if browser.tabs.is_empty() {
                continue; // still handshaking — treat as absent
            }
            let arriving = !self.present.contains(browser.browser_id);
            live_browsers.insert(browser.browser_id.to_string());
            for tab in browser.tabs {
                let key = (browser.browser_id.to_string(), tab.tab_id);
                self.observe_visit(now, &browser, tab, &key, arriving);
                self.observe_play(now, &browser, tab, &key);
                live_tabs.insert(key);
            }
            if arriving {
                self.settle_leftovers(browser.browser_id);
            }
        }
        self.reconcile_absent(now, &live_browsers, &live_tabs);
        self.present = live_browsers;
    }

    /// Time-driven housekeeping, called on the service tick: end sessions
    /// whose browser stayed away past the grace window, checkpoint long plays,
    /// and forget visits too old to resume.
    pub fn sweep(&mut self, now: i64) {
        let expired_visits: Vec<(TabKey, i64)> = self
            .visits
            .iter()
            .filter_map(|(k, v)| missing_past_grace(v.missing_since, now).map(|s| (k.clone(), s)))
            .collect();
        for (key, since) in expired_visits {
            self.close_visit(&key, since, true);
        }

        let expired_plays: Vec<(TabKey, i64)> = self
            .plays
            .iter()
            .filter_map(|(k, p)| missing_past_grace(p.missing_since, now).map(|s| (k.clone(), s)))
            .collect();
        for (key, since) in expired_plays {
            self.close_play(&key, since);
        }

        let due: Vec<TabKey> = self
            .plays
            .iter()
            .filter(|(_, p)| p.persist && p.playing_since.is_some())
            .filter(|(_, p)| match p.written_played_ms {
                None => p.played_at(now) >= MIN_PLAY_MS,
                Some(written) => p.played_at(now) - written >= PLAY_CHECKPOINT_MS,
            })
            .map(|(k, _)| k.clone())
            .collect();
        for key in due {
            self.stage_play(&key, now);
        }

        self.resumable.retain(|_, v| {
            v.ended_at_ms
                .is_some_and(|end| now - end < RESUME_WINDOW_MS)
        });
    }

    /// PilPod is exiting: end everything. Visits stay resumable — the tabs are
    /// most likely still open and will be picked up on the next start.
    pub fn shutdown(&mut self, now: i64) {
        self.close_everything(now, true);
        self.present.clear();
    }

    /// The user deleted these rows. Open sessions keep being tracked (so the
    /// same page does not instantly reappear as a "new" visit) but are never
    /// written again; staged writes for them are dropped.
    pub fn forget(&mut self, kind: HistoryKind, ids: &[i64]) {
        let ids: HashSet<i64> = ids.iter().copied().collect();
        self.forget_matching(Some(kind), |id, _| ids.contains(&id));
    }

    /// The user cleared a time range (`started_at_ms` in `[from, to)`, open
    /// ends unbounded), for one kind or both (`None`).
    pub fn forget_range(&mut self, kind: Option<HistoryKind>, from: Option<i64>, to: Option<i64>) {
        self.forget_matching(kind, |_, started| {
            from.is_none_or(|f| started >= f) && to.is_none_or(|t| started < t)
        });
    }

    /// Drain staged rows, visits first, each kind in id order.
    pub fn take_writes(&mut self) -> Vec<HistoryWrite> {
        let visits = std::mem::take(&mut self.pending_visits)
            .into_values()
            .map(|(visit, resumable)| HistoryWrite::Visit { visit, resumable });
        let plays = std::mem::take(&mut self.pending_plays)
            .into_values()
            .map(HistoryWrite::Play);
        visits.chain(plays).collect()
    }

    /// Put back rows the store failed to save. A row staged again in the
    /// meantime is newer and wins.
    pub fn restore_writes(&mut self, writes: Vec<HistoryWrite>) {
        for write in writes {
            match write {
                HistoryWrite::Visit { visit, resumable } => {
                    self.pending_visits
                        .entry(visit.id)
                        .or_insert((visit, resumable));
                }
                HistoryWrite::Play(play) => {
                    self.pending_plays.entry(play.id).or_insert(play);
                }
            }
        }
    }

    // ── Visits ─────────────────────────────────────────────────────────────

    fn observe_visit(
        &mut self,
        now: i64,
        browser: &BrowserObservation,
        tab: &BrowserTab,
        key: &TabKey,
        may_resume: bool,
    ) {
        let url = recordable_url(&tab.url);
        if let Some(open) = self.visits.get_mut(key) {
            if url.as_deref() == Some(open.visit.url.as_str()) {
                open.missing_since = None;
                if refresh_visit(&mut open.visit, tab) && open.persist {
                    let visit = open.visit.clone();
                    self.pending_visits.insert(visit.id, (visit, false));
                }
                return;
            }
            // Navigated elsewhere (or to a page we do not record).
            self.close_visit(key, now, false);
        }
        if let Some(url) = url {
            self.start_visit(now, browser, tab, key.clone(), url, may_resume);
        }
    }

    fn start_visit(
        &mut self,
        now: i64,
        browser: &BrowserObservation,
        tab: &BrowserTab,
        key: TabKey,
        url: String,
        may_resume: bool,
    ) {
        let resume_key = (browser.browser_id.to_string(), url);
        let resumed = if may_resume {
            self.resumable.remove(&resume_key)
        } else {
            None
        };
        let mut visit = match resumed {
            Some(mut previous) => {
                previous.ended_at_ms = None;
                previous
            }
            None => {
                let id = self.next_visit_id;
                self.next_visit_id += 1;
                PageVisit {
                    id,
                    url: resume_key.1,
                    title: String::new(),
                    favicon_url: None,
                    browser_id: browser.browser_id.to_string(),
                    os_browser_id: browser.os_browser_id.to_string(),
                    browser_name: browser.browser_name.to_string(),
                    started_at_ms: now,
                    ended_at_ms: None,
                }
            }
        };
        refresh_visit(&mut visit, tab);
        self.pending_visits.insert(visit.id, (visit.clone(), false));
        self.visits.insert(
            key,
            OpenVisit {
                visit,
                persist: true,
                missing_since: None,
            },
        );
    }

    /// An arriving browser claimed the visits it still has open; the rest were
    /// closed while it was away. Settle them as ordinary closed rows.
    fn settle_leftovers(&mut self, browser_id: &str) {
        let leftovers: Vec<ResumeKey> = self
            .resumable
            .keys()
            .filter(|(id, _)| id == browser_id)
            .cloned()
            .collect();
        for key in leftovers {
            if let Some(visit) = self.resumable.remove(&key) {
                self.pending_visits.insert(visit.id, (visit, false));
            }
        }
    }

    fn close_visit(&mut self, key: &TabKey, end: i64, resumable: bool) {
        let Some(open) = self.visits.remove(key) else {
            return;
        };
        if !open.persist {
            return;
        }
        let mut visit = open.visit;
        visit.ended_at_ms = Some(end.max(visit.started_at_ms));
        if resumable {
            self.resumable
                .insert((visit.browser_id.clone(), visit.url.clone()), visit.clone());
        }
        self.pending_visits.insert(visit.id, (visit, resumable));
    }

    // ── Media ──────────────────────────────────────────────────────────────

    fn observe_play(
        &mut self,
        now: i64,
        browser: &BrowserObservation,
        tab: &BrowserTab,
        key: &TabKey,
    ) {
        let identity = media_identity(tab);
        if let Some(open) = self.plays.get_mut(key) {
            if let Some((_, media)) = identity.as_ref().filter(|(id, _)| open.is_same_media(id)) {
                open.missing_since = None;
                let mut changed = refresh_play(&mut open.play, media);
                match (is_playing(media), open.playing_since) {
                    (true, None) => open.playing_since = Some(now),
                    (false, Some(_)) => {
                        open.settle(now);
                        changed = true;
                    }
                    _ => {}
                }
                if changed {
                    self.stage_play(key, now);
                }
                return;
            }
            // Different media (or none) in this tab now.
            self.close_play(key, now);
        }
        if let Some((id, media)) = identity {
            // A paused player that never played is not a play.
            if is_playing(media) {
                self.start_play(now, browser, tab, key.clone(), id, media);
            }
        }
    }

    fn start_play(
        &mut self,
        now: i64,
        browser: &BrowserObservation,
        tab: &BrowserTab,
        key: TabKey,
        identity: MediaIdentity,
        media: &TabMedia,
    ) {
        let id = self.next_play_id;
        self.next_play_id += 1;
        let play = MediaPlay {
            id,
            url: identity.url,
            title: identity.title,
            artist: identity.artist,
            album: clean_opt(&media.album),
            artwork_url: clean_link(&media.artwork_url),
            page_title: clean_text(&tab.title),
            duration_secs: clean_duration(media.duration),
            played_ms: 0,
            browser_id: browser.browser_id.to_string(),
            os_browser_id: browser.os_browser_id.to_string(),
            browser_name: browser.browser_name.to_string(),
            started_at_ms: now,
            ended_at_ms: None,
        };
        self.plays.insert(
            key,
            OpenPlay {
                play,
                persist: true,
                playing_since: Some(now),
                missing_since: None,
                written_played_ms: None,
            },
        );
    }

    /// Stage the current state of an open play — if it has played long enough
    /// to be worth a row (or already has one).
    fn stage_play(&mut self, key: &TabKey, now: i64) {
        let Some(open) = self.plays.get_mut(key) else {
            return;
        };
        let played = open.played_at(now);
        if !open.persist || (open.written_played_ms.is_none() && played < MIN_PLAY_MS) {
            return;
        }
        open.written_played_ms = Some(played);
        let mut row = open.play.clone();
        row.played_ms = played;
        self.pending_plays.insert(row.id, row);
    }

    fn close_play(&mut self, key: &TabKey, end: i64) {
        let Some(mut open) = self.plays.remove(key) else {
            return;
        };
        open.settle(end);
        let worth_keeping = open.written_played_ms.is_some() || open.play.played_ms >= MIN_PLAY_MS;
        if !open.persist || !worth_keeping {
            return;
        }
        let mut row = open.play;
        row.ended_at_ms = Some(end.max(row.started_at_ms));
        self.pending_plays.insert(row.id, row);
    }

    // ── Shared ─────────────────────────────────────────────────────────────

    fn reconcile_absent(
        &mut self,
        now: i64,
        live_browsers: &HashSet<String>,
        live_tabs: &HashSet<TabKey>,
    ) {
        let absent_visits: Vec<TabKey> = self
            .visits
            .keys()
            .filter(|k| !live_tabs.contains(*k))
            .cloned()
            .collect();
        for key in absent_visits {
            if live_browsers.contains(&key.0) {
                self.close_visit(&key, now, false);
            } else if let Some(open) = self.visits.get_mut(&key) {
                open.missing_since.get_or_insert(now);
            }
        }

        let absent_plays: Vec<TabKey> = self
            .plays
            .keys()
            .filter(|k| !live_tabs.contains(*k))
            .cloned()
            .collect();
        for key in absent_plays {
            if live_browsers.contains(&key.0) {
                self.close_play(&key, now);
            } else if let Some(open) = self.plays.get_mut(&key) {
                if open.missing_since.is_none() {
                    // Stop the clock where the browser vanished.
                    open.settle(now);
                    open.missing_since = Some(now);
                }
            }
        }
    }

    fn close_everything(&mut self, now: i64, resumable: bool) {
        let visits: Vec<(TabKey, i64)> = self
            .visits
            .iter()
            .map(|(k, v)| (k.clone(), v.missing_since.unwrap_or(now)))
            .collect();
        for (key, end) in visits {
            self.close_visit(&key, end, resumable);
        }
        let plays: Vec<(TabKey, i64)> = self
            .plays
            .iter()
            .map(|(k, p)| (k.clone(), p.missing_since.unwrap_or(now)))
            .collect();
        for (key, end) in plays {
            self.close_play(&key, end);
        }
    }

    fn forget_matching(&mut self, kind: Option<HistoryKind>, matches: impl Fn(i64, i64) -> bool) {
        if kind != Some(HistoryKind::Media) {
            for open in self.visits.values_mut() {
                if matches(open.visit.id, open.visit.started_at_ms) {
                    open.persist = false;
                }
            }
            self.pending_visits
                .retain(|_, (v, _)| !matches(v.id, v.started_at_ms));
            self.resumable
                .retain(|_, v| !matches(v.id, v.started_at_ms));
        }
        if kind != Some(HistoryKind::Pages) {
            for open in self.plays.values_mut() {
                if matches(open.play.id, open.play.started_at_ms) {
                    open.persist = false;
                }
            }
            self.pending_plays
                .retain(|_, p| !matches(p.id, p.started_at_ms));
        }
    }
}

// ── Normalization helpers ────────────────────────────────────────────────────

fn missing_past_grace(missing_since: Option<i64>, now: i64) -> Option<i64> {
    missing_since.filter(|since| now - since >= MISSING_GRACE_MS)
}

/// The URL a visit is recorded under, or `None` for pages that are not part of
/// browsing history (`chrome://`, `about:`, extension pages, `file:`…).
/// The fragment is dropped: in-page anchors are the same visit.
fn recordable_url(raw: &str) -> Option<String> {
    let url = raw.trim();
    let url = url.split('#').next().unwrap_or("");
    let lower = url.get(..8).unwrap_or(url).to_ascii_lowercase();
    let web = lower.starts_with("https://") || lower.starts_with("http://");
    let has_host = url
        .split_once("://")
        .is_some_and(|(_, rest)| !rest.is_empty());
    let sane = url.len() <= MAX_URL_LEN && !url.chars().any(char::is_control);
    (web && has_host && sane).then(|| url.to_string())
}

fn clean_text(raw: &str) -> String {
    raw.trim().chars().take(MAX_TEXT_LEN).collect()
}

fn clean_opt(raw: &str) -> Option<String> {
    Some(clean_text(raw)).filter(|s| !s.is_empty())
}

/// Favicons and artwork: keep short links (including small `data:` icons),
/// drop anything that would bloat every row.
fn clean_link(raw: &str) -> Option<String> {
    let link = raw.trim();
    (!link.is_empty() && link.len() <= MAX_URL_LEN).then(|| link.to_string())
}

fn clean_duration(secs: f64) -> Option<f64> {
    (secs.is_finite() && secs > 0.0).then_some(secs)
}

fn is_playing(media: &TabMedia) -> bool {
    media.playback_state == "playing"
}

/// Title and favicon arrive after the URL; take the latest non-empty values.
fn refresh_visit(visit: &mut PageVisit, tab: &BrowserTab) -> bool {
    let mut changed = false;
    let title = clean_text(&tab.title);
    if !title.is_empty() && title != visit.title {
        visit.title = title;
        changed = true;
    }
    if let Some(icon) = clean_link(&tab.favicon_url) {
        if visit.favicon_url.as_deref() != Some(icon.as_str()) {
            visit.favicon_url = Some(icon);
            changed = true;
        }
    }
    changed
}

/// Metadata that can fill in after a play starts (artwork loads late,
/// duration is unknown until the media is buffered).
fn refresh_play(play: &mut MediaPlay, media: &TabMedia) -> bool {
    let mut changed = false;
    if let Some(album) = clean_opt(&media.album) {
        if play.album.as_deref() != Some(album.as_str()) {
            play.album = Some(album);
            changed = true;
        }
    }
    if let Some(art) = clean_link(&media.artwork_url) {
        if play.artwork_url.as_deref() != Some(art.as_str()) {
            play.artwork_url = Some(art);
            changed = true;
        }
    }
    if let Some(duration) = clean_duration(media.duration) {
        if play
            .duration_secs
            .is_none_or(|d| (d - duration).abs() >= 1.0)
        {
            play.duration_secs = Some(duration);
            changed = true;
        }
    }
    changed
}

fn media_identity(tab: &BrowserTab) -> Option<(MediaIdentity, &TabMedia)> {
    let media = tab.media.as_ref()?;
    let url = recordable_url(&tab.url)?;
    let title = clean_opt(&media.title).or_else(|| clean_opt(&tab.title))?;
    Some((
        MediaIdentity {
            url,
            title,
            artist: clean_opt(&media.artist),
        },
        media,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const B1: &str = "profile-1";
    const B2: &str = "profile-2";
    const S: i64 = 1_000;

    fn tab(tab_id: i64, url: &str, title: &str) -> BrowserTab {
        BrowserTab {
            tab_id,
            window_id: 1,
            url: url.into(),
            title: title.into(),
            ..Default::default()
        }
    }

    fn media_tab(tab_id: i64, url: &str, title: &str, state: &str) -> BrowserTab {
        let mut t = tab(tab_id, url, "Page");
        let mut media: TabMedia = serde_json::from_str("{}").expect("default media");
        media.title = title.into();
        media.artist = "Artist".into();
        media.playback_state = state.into();
        t.media = Some(media);
        t
    }

    fn browser<'a>(id: &'a str, tabs: &'a [BrowserTab]) -> BrowserObservation<'a> {
        BrowserObservation {
            browser_id: id,
            os_browser_id: "chrome",
            browser_name: "Chrome",
            tabs,
        }
    }

    fn recorder() -> Recorder {
        Recorder::new(RecorderSeed::default(), true)
    }

    fn visits(writes: &[HistoryWrite]) -> Vec<(PageVisit, bool)> {
        writes
            .iter()
            .filter_map(|w| match w {
                HistoryWrite::Visit { visit, resumable } => Some((visit.clone(), *resumable)),
                _ => None,
            })
            .collect()
    }

    fn plays(writes: &[HistoryWrite]) -> Vec<MediaPlay> {
        writes
            .iter()
            .filter_map(|w| match w {
                HistoryWrite::Play(p) => Some(p.clone()),
                _ => None,
            })
            .collect()
    }

    // ── Visits ─────────────────────────────────────────────────────────────

    #[test]
    fn new_tab_starts_an_open_visit() {
        let mut r = recorder();
        let tabs = [tab(1, "https://example.com/a#top", "A")];
        r.observe(10 * S, [browser(B1, &tabs)]);
        let v = visits(&r.take_writes());
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].0.url, "https://example.com/a", "fragment dropped");
        assert_eq!(v[0].0.title, "A");
        assert_eq!(v[0].0.started_at_ms, 10 * S);
        assert_eq!(v[0].0.ended_at_ms, None);
    }

    #[test]
    fn non_web_pages_are_ignored() {
        let mut r = recorder();
        let tabs = [
            tab(1, "chrome://newtab/", "New Tab"),
            tab(2, "about:blank", ""),
            tab(3, "chrome-extension://abc/page.html", "Ext"),
            tab(4, "file:///C:/x.txt", "x"),
        ];
        r.observe(S, [browser(B1, &tabs)]);
        assert!(r.take_writes().is_empty());
    }

    #[test]
    fn unchanged_snapshot_writes_nothing() {
        let mut r = recorder();
        let tabs = [tab(1, "https://example.com", "A")];
        r.observe(S, [browser(B1, &tabs)]);
        r.take_writes();
        r.observe(2 * S, [browser(B1, &tabs)]);
        assert!(r.take_writes().is_empty());
    }

    #[test]
    fn late_title_updates_the_same_visit() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://example.com", "")])]);
        let first = visits(&r.take_writes());
        r.observe(
            2 * S,
            [browser(B1, &[tab(1, "https://example.com", "Example")])],
        );
        let second = visits(&r.take_writes());
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].0.id, first[0].0.id);
        assert_eq!(second[0].0.title, "Example");
    }

    #[test]
    fn navigation_closes_the_old_visit_and_opens_a_new_one() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        r.take_writes();
        r.observe(5 * S, [browser(B1, &[tab(1, "https://b.com", "B")])]);
        let v = visits(&r.take_writes());
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].0.url, "https://a.com");
        assert_eq!(v[0].0.ended_at_ms, Some(5 * S));
        assert!(!v[0].1, "a navigation is not resumable");
        assert_eq!(v[1].0.url, "https://b.com");
        assert_eq!(v[1].0.ended_at_ms, None);
    }

    #[test]
    fn closed_tab_in_a_live_browser_ends_immediately() {
        let mut r = recorder();
        r.observe(
            S,
            [browser(
                B1,
                &[tab(1, "https://a.com", "A"), tab(2, "https://b.com", "B")],
            )],
        );
        r.take_writes();
        r.observe(3 * S, [browser(B1, &[tab(2, "https://b.com", "B")])]);
        let v = visits(&r.take_writes());
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].0.url, "https://a.com");
        assert_eq!(v[0].0.ended_at_ms, Some(3 * S));
        assert!(!v[0].1);
    }

    #[test]
    fn browser_blip_within_grace_changes_nothing() {
        let mut r = recorder();
        let tabs = [tab(1, "https://a.com", "A")];
        r.observe(S, [browser(B1, &tabs)]);
        r.take_writes();
        r.observe(2 * S, []);
        r.sweep(2 * S + MISSING_GRACE_MS - 1);
        r.observe(3 * S, [browser(B1, &tabs)]);
        r.sweep(3 * S + MISSING_GRACE_MS * 2);
        assert!(r.take_writes().is_empty());
    }

    #[test]
    fn browser_gone_past_grace_ends_resumable_at_disappearance() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        r.take_writes();
        r.observe(2 * S, []);
        r.sweep(2 * S + MISSING_GRACE_MS);
        let v = visits(&r.take_writes());
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].0.ended_at_ms, Some(2 * S));
        assert!(v[0].1, "browser left: resumable");
    }

    #[test]
    fn restarted_browser_resumes_the_visit_under_a_new_tab_id() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        let id = visits(&r.take_writes())[0].0.id;
        r.observe(2 * S, []);
        r.sweep(2 * S + MISSING_GRACE_MS);
        r.take_writes();
        // Browser comes back; restored tab has a fresh id.
        r.observe(60 * S, [browser(B1, &[tab(77, "https://a.com", "A")])]);
        let v = visits(&r.take_writes());
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].0.id, id);
        assert_eq!(v[0].0.started_at_ms, S);
        assert_eq!(v[0].0.ended_at_ms, None);
    }

    #[test]
    fn page_opened_after_the_browser_returned_is_a_new_visit() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        let id = visits(&r.take_writes())[0].0.id;
        r.shutdown(2 * S);
        r.take_writes();
        // Browser returns without a.com (closed while away)…
        r.observe(3 * S, [browser(B1, &[tab(5, "https://b.com", "B")])]);
        let settled = visits(&r.take_writes());
        let leftover = settled
            .iter()
            .find(|(v, _)| v.id == id)
            .expect("leftover settled");
        assert!(!leftover.1, "no longer resumable");
        assert_eq!(leftover.0.ended_at_ms, Some(2 * S));
        // …and a.com opened later is a fresh visit.
        r.observe(
            4 * S,
            [browser(
                B1,
                &[tab(5, "https://b.com", "B"), tab(6, "https://a.com", "A")],
            )],
        );
        let v = visits(&r.take_writes());
        assert_eq!(v.len(), 1);
        assert_ne!(v[0].0.id, id);
        assert_eq!(v[0].0.started_at_ms, 4 * S);
    }

    #[test]
    fn handshaking_browser_with_no_tabs_does_not_consume_its_arrival() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        let id = visits(&r.take_writes())[0].0.id;
        r.shutdown(2 * S);
        r.take_writes();
        r.observe(3 * S, [browser(B1, &[])]);
        assert!(r.take_writes().is_empty());
        r.observe(4 * S, [browser(B1, &[tab(9, "https://a.com", "A")])]);
        assert_eq!(visits(&r.take_writes())[0].0.id, id);
    }

    #[test]
    fn resume_is_scoped_to_the_same_profile() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        let id = visits(&r.take_writes())[0].0.id;
        r.shutdown(2 * S);
        r.take_writes();
        r.observe(3 * S, [browser(B2, &[tab(1, "https://a.com", "A")])]);
        let v = visits(&r.take_writes());
        assert_ne!(v[0].0.id, id);
    }

    #[test]
    fn seeded_visits_resume_after_an_app_restart() {
        let previous = PageVisit {
            id: 41,
            url: "https://a.com".into(),
            title: "A".into(),
            favicon_url: None,
            browser_id: B1.into(),
            os_browser_id: "chrome".into(),
            browser_name: "Chrome".into(),
            started_at_ms: S,
            ended_at_ms: Some(2 * S),
        };
        let seed = RecorderSeed {
            next_visit_id: 42,
            next_play_id: 1,
            resumable: vec![previous],
        };
        let mut r = Recorder::new(seed, true);
        r.observe(
            3 * S,
            [browser(
                B1,
                &[tab(9, "https://a.com", "A"), tab(10, "https://b.com", "B")],
            )],
        );
        let v = visits(&r.take_writes());
        assert_eq!(
            v.iter().map(|(v, _)| v.id).collect::<Vec<_>>(),
            vec![41, 42]
        );
    }

    #[test]
    fn resumable_visits_expire() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        let id = visits(&r.take_writes())[0].0.id;
        r.shutdown(2 * S);
        r.sweep(2 * S + RESUME_WINDOW_MS);
        r.take_writes();
        r.observe(
            3 * S + RESUME_WINDOW_MS,
            [browser(B1, &[tab(1, "https://a.com", "A")])],
        );
        assert_ne!(visits(&r.take_writes())[0].0.id, id);
    }

    #[test]
    fn shutdown_closes_everything_resumably() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        r.take_writes();
        r.shutdown(9 * S);
        let v = visits(&r.take_writes());
        assert_eq!(v[0].0.ended_at_ms, Some(9 * S));
        assert!(v[0].1);
    }

    #[test]
    fn paused_recorder_records_nothing_and_closes_open_visits() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        r.take_writes();
        r.set_enabled(false, 2 * S);
        let v = visits(&r.take_writes());
        assert_eq!(v[0].0.ended_at_ms, Some(2 * S));
        assert!(!v[0].1, "pausing is not resumable");
        r.observe(3 * S, [browser(B1, &[tab(1, "https://b.com", "B")])]);
        assert!(r.take_writes().is_empty());
    }

    #[test]
    fn forgotten_open_visit_is_never_written_again() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        let id = visits(&r.take_writes())[0].0.id;
        r.forget(HistoryKind::Pages, &[id]);
        r.observe(
            2 * S,
            [browser(B1, &[tab(1, "https://a.com", "A renamed")])],
        );
        r.observe(3 * S, [browser(B1, &[tab(99, "chrome://newtab/", "")])]);
        assert!(r.take_writes().is_empty());
        // The next page in that tab is recorded normally.
        r.observe(4 * S, [browser(B1, &[tab(1, "https://b.com", "B")])]);
        assert_eq!(visits(&r.take_writes()).len(), 1);
    }

    #[test]
    fn forget_drops_staged_writes() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        r.forget_range(None, None, None);
        assert!(r.take_writes().is_empty());
    }

    #[test]
    fn forget_range_only_touches_rows_inside_it() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "A")])]);
        r.observe(
            5 * S,
            [browser(
                B1,
                &[tab(1, "https://a.com", "A"), tab(2, "https://b.com", "B")],
            )],
        );
        r.forget_range(Some(HistoryKind::Pages), Some(4 * S), None);
        let v = visits(&r.take_writes());
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].0.url, "https://a.com");
    }

    #[test]
    fn restore_writes_never_overrides_a_newer_staged_row() {
        let mut r = recorder();
        r.observe(S, [browser(B1, &[tab(1, "https://a.com", "Old")])]);
        let failed = r.take_writes();
        r.observe(2 * S, [browser(B1, &[tab(1, "https://a.com", "New")])]);
        r.restore_writes(failed);
        let v = visits(&r.take_writes());
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].0.title, "New");
    }

    // ── Media ──────────────────────────────────────────────────────────────

    #[test]
    fn short_plays_are_not_recorded() {
        let mut r = recorder();
        r.observe(
            S,
            [browser(
                B1,
                &[media_tab(1, "https://yt.com/w?v=1", "Song", "playing")],
            )],
        );
        r.observe(
            S + MIN_PLAY_MS - 1,
            [browser(
                B1,
                &[media_tab(1, "https://yt.com/w?v=1", "Song", "paused")],
            )],
        );
        r.observe(20 * S, [browser(B1, &[tab(99, "chrome://newtab/", "")])]);
        assert!(plays(&r.take_writes()).is_empty());
    }

    #[test]
    fn paused_media_that_never_played_is_not_a_play() {
        let mut r = recorder();
        r.observe(
            S,
            [browser(
                B1,
                &[media_tab(1, "https://yt.com/w?v=1", "Song", "paused")],
            )],
        );
        r.sweep(S + MIN_PLAY_MS * 10);
        assert!(plays(&r.take_writes()).is_empty());
    }

    #[test]
    fn play_is_recorded_once_it_crosses_the_threshold() {
        let mut r = recorder();
        let playing = [media_tab(1, "https://yt.com/w?v=1", "Song", "playing")];
        r.observe(0, [browser(B1, &playing)]);
        r.sweep(MIN_PLAY_MS - 1);
        assert!(plays(&r.take_writes()).is_empty());
        r.sweep(MIN_PLAY_MS);
        let p = plays(&r.take_writes());
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].title, "Song");
        assert_eq!(p[0].artist.as_deref(), Some("Artist"));
        assert_eq!(p[0].played_ms, MIN_PLAY_MS);
        assert_eq!(p[0].ended_at_ms, None);
    }

    #[test]
    fn played_time_excludes_pauses() {
        let mut r = recorder();
        let url = "https://yt.com/w?v=1";
        r.observe(0, [browser(B1, &[media_tab(1, url, "Song", "playing")])]);
        r.observe(
            30 * S,
            [browser(B1, &[media_tab(1, url, "Song", "paused")])],
        );
        r.observe(
            100 * S,
            [browser(B1, &[media_tab(1, url, "Song", "playing")])],
        );
        r.observe(110 * S, [browser(B1, &[tab(99, "chrome://newtab/", "")])]);
        let p = plays(&r.take_writes());
        let last = p.last().unwrap();
        assert_eq!(last.played_ms, 40 * S);
        assert_eq!(last.started_at_ms, 0);
        assert_eq!(last.ended_at_ms, Some(110 * S));
    }

    #[test]
    fn track_change_on_the_same_url_is_a_new_play() {
        let mut r = recorder();
        let url = "https://open.spotify.com/";
        r.observe(0, [browser(B1, &[media_tab(1, url, "Track 1", "playing")])]);
        r.observe(
            60 * S,
            [browser(B1, &[media_tab(1, url, "Track 2", "playing")])],
        );
        r.observe(120 * S, [browser(B1, &[tab(99, "chrome://newtab/", "")])]);
        let p = plays(&r.take_writes());
        let titles: Vec<&str> = p.iter().map(|p| p.title.as_str()).collect();
        assert_eq!(titles, vec!["Track 1", "Track 2"]);
        assert_eq!(p[0].played_ms, 60 * S);
        assert_eq!(p[1].played_ms, 60 * S);
    }

    #[test]
    fn long_plays_are_checkpointed() {
        let mut r = recorder();
        r.observe(
            0,
            [browser(
                B1,
                &[media_tab(1, "https://yt.com/w?v=1", "Song", "playing")],
            )],
        );
        r.sweep(MIN_PLAY_MS);
        r.take_writes();
        r.sweep(MIN_PLAY_MS + PLAY_CHECKPOINT_MS - 1);
        assert!(r.take_writes().is_empty());
        r.sweep(MIN_PLAY_MS + PLAY_CHECKPOINT_MS);
        assert_eq!(
            plays(&r.take_writes())[0].played_ms,
            MIN_PLAY_MS + PLAY_CHECKPOINT_MS
        );
    }

    #[test]
    fn vanished_browser_stops_the_play_clock() {
        let mut r = recorder();
        r.observe(
            0,
            [browser(
                B1,
                &[media_tab(1, "https://yt.com/w?v=1", "Song", "playing")],
            )],
        );
        r.observe(30 * S, []);
        r.sweep(30 * S + MISSING_GRACE_MS);
        let p = plays(&r.take_writes());
        assert_eq!(p.last().unwrap().played_ms, 30 * S);
        assert_eq!(p.last().unwrap().ended_at_ms, Some(30 * S));
    }

    #[test]
    fn media_falls_back_to_the_page_title() {
        let mut r = recorder();
        let mut t = media_tab(1, "https://radio.example/live", "", "playing");
        t.title = "Live Radio".into();
        r.observe(0, [browser(B1, &[t])]);
        r.sweep(MIN_PLAY_MS);
        assert_eq!(plays(&r.take_writes())[0].title, "Live Radio");
    }

    #[test]
    fn recordable_url_rules() {
        assert_eq!(
            recordable_url(" https://a.com/x#y "),
            Some("https://a.com/x".into())
        );
        assert_eq!(recordable_url("HTTP://A.com"), Some("HTTP://A.com".into()));
        assert_eq!(recordable_url("https://"), None);
        assert_eq!(recordable_url("javascript:alert(1)"), None);
        assert_eq!(
            recordable_url(&format!("https://a.com/{}", "x".repeat(MAX_URL_LEN))),
            None
        );
    }
}
