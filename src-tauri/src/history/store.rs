//! The only file that touches the history database.
//!
//! History is the one PilPod dataset that grows without bound, so unlike the
//! vault's whole-file JSON it lives in SQLite (`app_data_dir()/history.sqlite3`,
//! bundled engine — nothing to install). Writes are small upserts batched in one
//! transaction per service tick; reads are keyset-paginated so the hundredth
//! page costs the same as the first.
//!
//! Schema changes go through [`MIGRATIONS`], applied in order against
//! `PRAGMA user_version`. Append a step; never edit one that has shipped.
//!
//! Failure policy mirrors the vault: a database that is corrupt, or was written
//! by a newer PilPod, is moved aside to `history.sqlite3.bak-<ms>` and a fresh
//! one started — the data is preserved for recovery, never silently deleted.
//! Any other failure (locked file, no permission) is returned to the caller,
//! which runs the session without history rather than touch the file.

use std::path::{Path, PathBuf};

use rusqlite::{params, params_from_iter, Connection, ErrorCode, OptionalExtension, Row};

use super::model::{
    HistoryCursor, HistoryKind, HistoryPage, HistoryQuery, HistorySettings, MediaPlay, PageVisit,
    MAX_RETENTION_DAYS,
};
use super::recorder::HistoryWrite;

pub const FILE_NAME: &str = "history.sqlite3";

const DEFAULT_PAGE: u32 = 50;
const MAX_PAGE: u32 = 200;
const MAX_SEARCH_LEN: usize = 200;

const KEY_RECORDING: &str = "recording";
const KEY_RETENTION_DAYS: &str = "retention_days";
const KEY_LAST_ALIVE: &str = "last_alive_ms";

/// One entry per schema version; index `i` upgrades `user_version` `i` → `i + 1`.
const MIGRATIONS: &[&str] = &[
    // v1 — page visits, media plays, settings.
    "
    CREATE TABLE page_visits (
        id             INTEGER PRIMARY KEY,
        url            TEXT    NOT NULL,
        title          TEXT    NOT NULL,
        favicon_url    TEXT,
        browser_id     TEXT    NOT NULL,
        os_browser_id  TEXT    NOT NULL,
        browser_name   TEXT    NOT NULL,
        started_at_ms  INTEGER NOT NULL,
        ended_at_ms    INTEGER,
        resumable      INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX page_visits_by_start ON page_visits (started_at_ms DESC, id DESC);
    CREATE INDEX page_visits_open ON page_visits (id) WHERE ended_at_ms IS NULL;
    CREATE INDEX page_visits_resumable ON page_visits (ended_at_ms) WHERE resumable = 1;

    CREATE TABLE media_plays (
        id             INTEGER PRIMARY KEY,
        url            TEXT    NOT NULL,
        title          TEXT    NOT NULL,
        artist         TEXT,
        album          TEXT,
        artwork_url    TEXT,
        page_title     TEXT    NOT NULL,
        duration_secs  REAL,
        played_ms      INTEGER NOT NULL,
        browser_id     TEXT    NOT NULL,
        os_browser_id  TEXT    NOT NULL,
        browser_name   TEXT    NOT NULL,
        started_at_ms  INTEGER NOT NULL,
        ended_at_ms    INTEGER
    );
    CREATE INDEX media_plays_by_start ON media_plays (started_at_ms DESC, id DESC);
    CREATE INDEX media_plays_open ON media_plays (id) WHERE ended_at_ms IS NULL;

    CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
    ) WITHOUT ROWID;
    ",
];

const VISIT_COLUMNS: &str = "id, url, title, favicon_url, browser_id, os_browser_id, \
                             browser_name, started_at_ms, ended_at_ms";
const PLAY_COLUMNS: &str = "id, url, title, artist, album, artwork_url, page_title, \
                            duration_secs, played_ms, browser_id, os_browser_id, \
                            browser_name, started_at_ms, ended_at_ms";

const UPSERT_VISIT: &str = "
    INSERT INTO page_visits (id, url, title, favicon_url, browser_id, os_browser_id,
                             browser_name, started_at_ms, ended_at_ms, resumable)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    ON CONFLICT (id) DO UPDATE SET
        url = excluded.url, title = excluded.title, favicon_url = excluded.favicon_url,
        browser_name = excluded.browser_name, ended_at_ms = excluded.ended_at_ms,
        resumable = excluded.resumable";

const UPSERT_PLAY: &str = "
    INSERT INTO media_plays (id, url, title, artist, album, artwork_url, page_title,
                             duration_secs, played_ms, browser_id, os_browser_id,
                             browser_name, started_at_ms, ended_at_ms)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
    ON CONFLICT (id) DO UPDATE SET
        album = excluded.album, artwork_url = excluded.artwork_url,
        page_title = excluded.page_title, duration_secs = excluded.duration_secs,
        played_ms = excluded.played_ms, ended_at_ms = excluded.ended_at_ms";

fn table(kind: HistoryKind) -> &'static str {
    match kind {
        HistoryKind::Pages => "page_visits",
        HistoryKind::Media => "media_plays",
    }
}

fn kinds(kind: Option<HistoryKind>) -> &'static [HistoryKind] {
    match kind {
        Some(HistoryKind::Pages) => &[HistoryKind::Pages],
        Some(HistoryKind::Media) => &[HistoryKind::Media],
        None => &[HistoryKind::Pages, HistoryKind::Media],
    }
}

fn sql_err(e: rusqlite::Error) -> String {
    format!("sqlite: {e}")
}

/// Why opening failed — decides whether the file is moved aside.
enum OpenError {
    /// Corrupt, not a database, or from a newer schema: back up, start fresh.
    Unusable(String),
    /// Anything else (locked, permissions…): leave the file alone.
    Other(String),
}

impl From<rusqlite::Error> for OpenError {
    fn from(e: rusqlite::Error) -> Self {
        let unusable = matches!(
            e.sqlite_error_code(),
            Some(ErrorCode::NotADatabase | ErrorCode::DatabaseCorrupt)
        );
        if unusable {
            OpenError::Unusable(sql_err(e))
        } else {
            OpenError::Other(sql_err(e))
        }
    }
}

pub struct HistoryStore {
    conn: Connection,
}

impl HistoryStore {
    /// Open (creating if needed) the database at `path`, applying migrations.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create_dir_all: {e}"))?;
        }
        match Self::try_open(path) {
            Ok(store) => Ok(store),
            Err(OpenError::Other(e)) => Err(e),
            Err(OpenError::Unusable(reason)) => {
                log::warn!("[history] {reason} — moving the database aside");
                move_aside(path)?;
                Self::try_open(path).map_err(|e| match e {
                    OpenError::Unusable(e) | OpenError::Other(e) => e,
                })
            }
        }
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(sql_err)?;
        Self::prepare(conn).map_err(|e| match e {
            OpenError::Unusable(e) | OpenError::Other(e) => e,
        })
    }

    fn try_open(path: &Path) -> Result<Self, OpenError> {
        Self::prepare(Connection::open(path)?)
    }

    fn prepare(mut conn: Connection) -> Result<Self, OpenError> {
        // WAL: readers (the UI) never wait on the writer tick. NORMAL sync is
        // durable across app crashes; at worst a power cut loses the last tick.
        conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        migrate(&mut conn)?;
        Ok(Self { conn })
    }

    // ── Writes ─────────────────────────────────────────────────────────────

    /// Upsert a batch of rows in one transaction (all or nothing).
    pub fn apply(&mut self, writes: &[HistoryWrite]) -> Result<(), String> {
        if writes.is_empty() {
            return Ok(());
        }
        let tx = self.conn.transaction().map_err(sql_err)?;
        {
            let mut visit_stmt = tx.prepare_cached(UPSERT_VISIT).map_err(sql_err)?;
            let mut play_stmt = tx.prepare_cached(UPSERT_PLAY).map_err(sql_err)?;
            for write in writes {
                match write {
                    HistoryWrite::Visit {
                        visit: v,
                        resumable,
                    } => visit_stmt.execute(params![
                        v.id,
                        v.url,
                        v.title,
                        v.favicon_url,
                        v.browser_id,
                        v.os_browser_id,
                        v.browser_name,
                        v.started_at_ms,
                        v.ended_at_ms,
                        resumable,
                    ]),
                    HistoryWrite::Play(p) => play_stmt.execute(params![
                        p.id,
                        p.url,
                        p.title,
                        p.artist,
                        p.album,
                        p.artwork_url,
                        p.page_title,
                        p.duration_secs,
                        p.played_ms,
                        p.browser_id,
                        p.os_browser_id,
                        p.browser_name,
                        p.started_at_ms,
                        p.ended_at_ms,
                    ]),
                }
                .map_err(sql_err)?;
            }
        }
        tx.commit().map_err(sql_err)
    }

    pub fn delete(&mut self, kind: HistoryKind, ids: &[i64]) -> Result<usize, String> {
        let tx = self.conn.transaction().map_err(sql_err)?;
        let mut removed = 0;
        {
            let sql = format!("DELETE FROM {} WHERE id = ?1", table(kind));
            let mut stmt = tx.prepare(&sql).map_err(sql_err)?;
            for id in ids {
                removed += stmt.execute([id]).map_err(sql_err)?;
            }
        }
        tx.commit().map_err(sql_err)?;
        Ok(removed)
    }

    /// Delete rows whose `started_at_ms` is in `[from, to)` (open ends unbounded).
    pub fn clear(
        &mut self,
        kind: Option<HistoryKind>,
        from: Option<i64>,
        to: Option<i64>,
    ) -> Result<usize, String> {
        let tx = self.conn.transaction().map_err(sql_err)?;
        let mut removed = 0;
        for &k in kinds(kind) {
            let sql = format!(
                "DELETE FROM {} WHERE (?1 IS NULL OR started_at_ms >= ?1) \
                 AND (?2 IS NULL OR started_at_ms < ?2)",
                table(k)
            );
            removed += tx.execute(&sql, params![from, to]).map_err(sql_err)?;
        }
        tx.commit().map_err(sql_err)?;
        Ok(removed)
    }

    /// Retention: drop finished rows that ended before `cutoff_ms`. Open rows
    /// are never purged, however old they started.
    pub fn purge_ended_before(&mut self, cutoff_ms: i64) -> Result<usize, String> {
        let mut removed = 0;
        for &k in kinds(None) {
            let sql = format!(
                "DELETE FROM {} WHERE started_at_ms < ?1 AND ended_at_ms < ?1",
                table(k)
            );
            removed += self.conn.execute(&sql, [cutoff_ms]).map_err(sql_err)?;
        }
        Ok(removed)
    }

    /// After a crash, rows still marked open end at `end_ms` (the last moment
    /// PilPod was known alive). Visits become resumable, exactly as after a
    /// clean exit, so still-open tabs continue them.
    pub fn close_dangling(&mut self, end_ms: i64) -> Result<usize, String> {
        let visits = self
            .conn
            .execute(
                "UPDATE page_visits SET ended_at_ms = MAX(started_at_ms, ?1), resumable = 1 \
                 WHERE ended_at_ms IS NULL",
                [end_ms],
            )
            .map_err(sql_err)?;
        let plays = self
            .conn
            .execute(
                "UPDATE media_plays SET ended_at_ms = MAX(started_at_ms, ?1) \
                 WHERE ended_at_ms IS NULL",
                [end_ms],
            )
            .map_err(sql_err)?;
        Ok(visits + plays)
    }

    // ── Reads ──────────────────────────────────────────────────────────────

    pub fn query_pages(&self, query: &HistoryQuery) -> Result<HistoryPage<PageVisit>, String> {
        self.query(
            HistoryKind::Pages,
            VISIT_COLUMNS,
            &["title", "url"],
            query,
            visit_from_row,
            |v| HistoryCursor {
                started_at_ms: v.started_at_ms,
                id: v.id,
            },
        )
    }

    pub fn query_media(&self, query: &HistoryQuery) -> Result<HistoryPage<MediaPlay>, String> {
        self.query(
            HistoryKind::Media,
            PLAY_COLUMNS,
            &["title", "artist", "album", "page_title", "url"],
            query,
            play_from_row,
            |p| HistoryCursor {
                started_at_ms: p.started_at_ms,
                id: p.id,
            },
        )
    }

    /// Newest-first keyset page. The `(started_at_ms, id)` row-value
    /// comparison walks `*_by_start` directly, so depth does not cost scans.
    fn query<T>(
        &self,
        kind: HistoryKind,
        columns: &str,
        search_columns: &[&str],
        query: &HistoryQuery,
        from_row: fn(&Row) -> rusqlite::Result<T>,
        cursor_of: fn(&T) -> HistoryCursor,
    ) -> Result<HistoryPage<T>, String> {
        let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE) as usize;
        let mut conditions: Vec<String> = Vec::new();
        let mut values: Vec<rusqlite::types::Value> = Vec::new();

        if let Some(cursor) = query.before {
            conditions.push(format!(
                "(started_at_ms, id) < (?{}, ?{})",
                values.len() + 1,
                values.len() + 2
            ));
            values.push(cursor.started_at_ms.into());
            values.push(cursor.id.into());
        }
        if let Some(pattern) = like_pattern(query.search.as_deref()) {
            values.push(pattern.into());
            let n = values.len();
            let any = search_columns
                .iter()
                .map(|c| format!("{c} LIKE ?{n} ESCAPE '\\'"))
                .collect::<Vec<_>>()
                .join(" OR ");
            conditions.push(format!("({any})"));
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        // One extra row tells us whether there is a next page.
        let sql = format!(
            "SELECT {columns} FROM {} {where_clause} \
             ORDER BY started_at_ms DESC, id DESC LIMIT {}",
            table(kind),
            limit + 1
        );

        let mut stmt = self.conn.prepare_cached(&sql).map_err(sql_err)?;
        let mut items = stmt
            .query_map(params_from_iter(values), from_row)
            .map_err(sql_err)?
            .collect::<rusqlite::Result<Vec<T>>>()
            .map_err(sql_err)?;

        let next = if items.len() > limit {
            items.truncate(limit);
            items.last().map(cursor_of)
        } else {
            None
        };
        Ok(HistoryPage { items, next })
    }

    /// Visits that ended because their browser went away at or after `since_ms`.
    /// Oldest first, so when one URL appears twice the latest wins downstream.
    pub fn resumable_since(&self, since_ms: i64) -> Result<Vec<PageVisit>, String> {
        let sql = format!(
            "SELECT {VISIT_COLUMNS} FROM page_visits \
             WHERE resumable = 1 AND ended_at_ms >= ?1 ORDER BY ended_at_ms ASC"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(sql_err)?;
        let rows = stmt
            .query_map([since_ms], visit_from_row)
            .map_err(sql_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(sql_err)?;
        Ok(rows)
    }

    /// Next free ids for (visits, plays).
    pub fn next_ids(&self) -> Result<(i64, i64), String> {
        let next = |t: &str| -> Result<i64, String> {
            self.conn
                .query_row(
                    &format!("SELECT COALESCE(MAX(id), 0) + 1 FROM {t}"),
                    [],
                    |r| r.get(0),
                )
                .map_err(sql_err)
        };
        Ok((next("page_visits")?, next("media_plays")?))
    }

    // ── Settings ───────────────────────────────────────────────────────────

    pub fn settings(&self) -> Result<HistorySettings, String> {
        let defaults = HistorySettings::default();
        let recording = self
            .setting(KEY_RECORDING)?
            .map(|v| v == "1")
            .unwrap_or(defaults.recording);
        let retention_days = self
            .setting(KEY_RETENTION_DAYS)?
            .and_then(|v| v.parse::<u32>().ok())
            .filter(|d| *d <= MAX_RETENTION_DAYS)
            .unwrap_or(defaults.retention_days);
        Ok(HistorySettings {
            recording,
            retention_days,
        })
    }

    pub fn save_settings(&mut self, settings: &HistorySettings) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(sql_err)?;
        put_setting(
            &tx,
            KEY_RECORDING,
            if settings.recording { "1" } else { "0" },
        )?;
        put_setting(
            &tx,
            KEY_RETENTION_DAYS,
            &settings.retention_days.to_string(),
        )?;
        tx.commit().map_err(sql_err)
    }

    pub fn last_alive(&self) -> Result<Option<i64>, String> {
        Ok(self.setting(KEY_LAST_ALIVE)?.and_then(|v| v.parse().ok()))
    }

    pub fn set_last_alive(&mut self, ms: i64) -> Result<(), String> {
        put_setting(&self.conn, KEY_LAST_ALIVE, &ms.to_string())
    }

    fn setting(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(sql_err)
    }
}

fn put_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) \
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [key, value],
    )
    .map(|_| ())
    .map_err(sql_err)
}

fn migrate(conn: &mut Connection) -> Result<(), OpenError> {
    let current: usize =
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as usize;
    if current > MIGRATIONS.len() {
        return Err(OpenError::Unusable(format!(
            "schema v{current} is newer than this build (v{})",
            MIGRATIONS.len()
        )));
    }
    for (index, step) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(step)?;
        tx.pragma_update(None, "user_version", (index + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

/// Move a bad database (and its WAL sidecars) aside to `<file>.bak-<ms>`.
fn move_aside(path: &Path) -> Result<(), String> {
    let stamp = super::now_ms();
    let with_suffix = |p: &Path, suffix: &str| -> PathBuf {
        let mut name = p.file_name().map(|n| n.to_os_string()).unwrap_or_default();
        name.push(suffix);
        p.with_file_name(name)
    };
    let backup = with_suffix(path, &format!(".bak-{stamp}"));
    std::fs::rename(path, &backup).map_err(|e| format!("back up {}: {e}", path.display()))?;
    for sidecar in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(with_suffix(path, sidecar));
    }
    log::warn!("[history] previous database kept at {}", backup.display());
    Ok(())
}

/// `%term%` with LIKE metacharacters escaped; `None` for a blank search.
fn like_pattern(search: Option<&str>) -> Option<String> {
    let term: String = search?.trim().chars().take(MAX_SEARCH_LEN).collect();
    if term.is_empty() {
        return None;
    }
    let mut pattern = String::with_capacity(term.len() + 2);
    pattern.push('%');
    for c in term.chars() {
        if matches!(c, '%' | '_' | '\\') {
            pattern.push('\\');
        }
        pattern.push(c);
    }
    pattern.push('%');
    Some(pattern)
}

fn visit_from_row(row: &Row) -> rusqlite::Result<PageVisit> {
    Ok(PageVisit {
        id: row.get(0)?,
        url: row.get(1)?,
        title: row.get(2)?,
        favicon_url: row.get(3)?,
        browser_id: row.get(4)?,
        os_browser_id: row.get(5)?,
        browser_name: row.get(6)?,
        started_at_ms: row.get(7)?,
        ended_at_ms: row.get(8)?,
    })
}

fn play_from_row(row: &Row) -> rusqlite::Result<MediaPlay> {
    Ok(MediaPlay {
        id: row.get(0)?,
        url: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        artwork_url: row.get(5)?,
        page_title: row.get(6)?,
        duration_secs: row.get(7)?,
        played_ms: row.get(8)?,
        browser_id: row.get(9)?,
        os_browser_id: row.get(10)?,
        browser_name: row.get(11)?,
        started_at_ms: row.get(12)?,
        ended_at_ms: row.get(13)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_db() -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "pilpod_history_test_{}_{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(FILE_NAME)
    }

    fn visit(id: i64, started: i64, url: &str, title: &str) -> PageVisit {
        PageVisit {
            id,
            url: url.into(),
            title: title.into(),
            favicon_url: None,
            browser_id: "p1".into(),
            os_browser_id: "chrome".into(),
            browser_name: "Chrome".into(),
            started_at_ms: started,
            ended_at_ms: Some(started + 10),
        }
    }

    fn play(id: i64, started: i64, title: &str, artist: &str) -> MediaPlay {
        MediaPlay {
            id,
            url: "https://music.example/x".into(),
            title: title.into(),
            artist: Some(artist.into()),
            album: None,
            artwork_url: None,
            page_title: "Page".into(),
            duration_secs: Some(200.0),
            played_ms: 30_000,
            browser_id: "p1".into(),
            os_browser_id: "chrome".into(),
            browser_name: "Chrome".into(),
            started_at_ms: started,
            ended_at_ms: None,
        }
    }

    fn w(v: PageVisit) -> HistoryWrite {
        HistoryWrite::Visit {
            visit: v,
            resumable: false,
        }
    }

    fn page(
        store: &HistoryStore,
        search: Option<&str>,
        before: Option<HistoryCursor>,
        limit: u32,
    ) -> HistoryPage<PageVisit> {
        store
            .query_pages(&HistoryQuery {
                search: search.map(Into::into),
                before,
                limit: Some(limit),
            })
            .unwrap()
    }

    #[test]
    fn upsert_inserts_then_replaces() {
        let mut s = HistoryStore::open_in_memory().unwrap();
        s.apply(&[w(visit(1, 100, "https://a.com", "Old"))])
            .unwrap();
        let mut v = visit(1, 100, "https://a.com", "New");
        v.ended_at_ms = None;
        s.apply(&[w(v.clone())]).unwrap();
        assert_eq!(page(&s, None, None, 10).items, vec![v]);
    }

    #[test]
    fn pages_are_newest_first_and_paginate_without_gaps() {
        let mut s = HistoryStore::open_in_memory().unwrap();
        // Two rows share a timestamp: the id breaks the tie.
        let rows: Vec<HistoryWrite> = (1..=5)
            .map(|id| {
                w(visit(
                    id,
                    if id <= 2 { 100 } else { id * 100 },
                    "https://a.com",
                    "A",
                ))
            })
            .collect();
        s.apply(&rows).unwrap();

        let first = page(&s, None, None, 2);
        assert_eq!(
            first.items.iter().map(|v| v.id).collect::<Vec<_>>(),
            vec![5, 4]
        );
        let second = page(&s, None, first.next, 2);
        assert_eq!(
            second.items.iter().map(|v| v.id).collect::<Vec<_>>(),
            vec![3, 2]
        );
        let third = page(&s, None, second.next, 2);
        assert_eq!(
            third.items.iter().map(|v| v.id).collect::<Vec<_>>(),
            vec![1]
        );
        assert!(third.next.is_none());
    }

    #[test]
    fn search_matches_title_or_url_and_escapes_wildcards() {
        let mut s = HistoryStore::open_in_memory().unwrap();
        s.apply(&[
            w(visit(1, 1, "https://rust-lang.org", "Rust")),
            w(visit(2, 2, "https://example.com/100%", "Percent")),
            w(visit(3, 3, "https://example.com/x", "Other")),
        ])
        .unwrap();
        let ids = |q| {
            page(&s, Some(q), None, 10)
                .items
                .iter()
                .map(|v| v.id)
                .collect::<Vec<_>>()
        };
        assert_eq!(ids("RUST"), vec![1], "case-insensitive");
        assert_eq!(ids("100%"), vec![2], "% is literal");
        assert_eq!(ids("example"), vec![3, 2]);
        assert_eq!(ids("   "), vec![3, 2, 1], "blank search = everything");
    }

    #[test]
    fn media_search_covers_artist() {
        let mut s = HistoryStore::open_in_memory().unwrap();
        s.apply(&[
            HistoryWrite::Play(play(1, 1, "Song A", "Fairuz")),
            HistoryWrite::Play(play(2, 2, "Song B", "Someone")),
        ])
        .unwrap();
        let result = s
            .query_media(&HistoryQuery {
                search: Some("fairuz".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(result.items, vec![play(1, 1, "Song A", "Fairuz")]);
    }

    #[test]
    fn delete_and_clear_ranges() {
        let mut s = HistoryStore::open_in_memory().unwrap();
        s.apply(
            &(1..=4)
                .map(|id| w(visit(id, id * 100, "https://a.com", "A")))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        s.apply(&[HistoryWrite::Play(play(1, 250, "S", "A"))])
            .unwrap();

        assert_eq!(s.delete(HistoryKind::Pages, &[1, 99]).unwrap(), 1);
        // [200, 400) across both kinds: visits 2, 3 and the play at 250.
        assert_eq!(s.clear(None, Some(200), Some(400)).unwrap(), 3);
        assert_eq!(
            page(&s, None, None, 10)
                .items
                .iter()
                .map(|v| v.id)
                .collect::<Vec<_>>(),
            vec![4]
        );
        assert_eq!(s.clear(Some(HistoryKind::Pages), None, None).unwrap(), 1);
    }

    #[test]
    fn purge_keeps_open_rows_and_recent_ones() {
        let mut s = HistoryStore::open_in_memory().unwrap();
        let mut open = visit(1, 10, "https://open.com", "Open");
        open.ended_at_ms = None;
        let mut long_lived = visit(2, 10, "https://long.com", "Long");
        long_lived.ended_at_ms = Some(5_000);
        s.apply(&[
            w(open),
            w(long_lived),
            w(visit(3, 20, "https://old.com", "Old")),
        ])
        .unwrap();
        assert_eq!(s.purge_ended_before(1_000).unwrap(), 1);
        let ids: Vec<i64> = page(&s, None, None, 10)
            .items
            .iter()
            .map(|v| v.id)
            .collect();
        assert_eq!(ids, vec![2, 1]);
    }

    #[test]
    fn dangling_rows_close_resumably_after_a_crash() {
        let mut s = HistoryStore::open_in_memory().unwrap();
        let mut open = visit(1, 100, "https://a.com", "A");
        open.ended_at_ms = None;
        s.apply(&[w(open), HistoryWrite::Play(play(1, 100, "S", "A"))])
            .unwrap();
        assert_eq!(s.close_dangling(900).unwrap(), 2);
        let seed = s.resumable_since(0).unwrap();
        assert_eq!(seed.len(), 1);
        assert_eq!(seed[0].ended_at_ms, Some(900));
        assert!(s.resumable_since(901).unwrap().is_empty());
    }

    #[test]
    fn next_ids_follow_the_stored_rows() {
        let mut s = HistoryStore::open_in_memory().unwrap();
        assert_eq!(s.next_ids().unwrap(), (1, 1));
        s.apply(&[
            w(visit(7, 1, "https://a.com", "A")),
            HistoryWrite::Play(play(3, 1, "S", "A")),
        ])
        .unwrap();
        assert_eq!(s.next_ids().unwrap(), (8, 4));
    }

    #[test]
    fn settings_round_trip_with_defaults() {
        let mut s = HistoryStore::open_in_memory().unwrap();
        assert_eq!(s.settings().unwrap(), HistorySettings::default());
        let custom = HistorySettings {
            recording: false,
            retention_days: 0,
        };
        s.save_settings(&custom).unwrap();
        assert_eq!(s.settings().unwrap(), custom);
        assert_eq!(s.last_alive().unwrap(), None);
        s.set_last_alive(42).unwrap();
        assert_eq!(s.last_alive().unwrap(), Some(42));
    }

    #[test]
    fn data_survives_reopen() {
        let path = temp_db();
        {
            let mut s = HistoryStore::open(&path).unwrap();
            s.apply(&[w(visit(1, 1, "https://a.com", "A"))]).unwrap();
        }
        let s = HistoryStore::open(&path).unwrap();
        assert_eq!(page(&s, None, None, 10).items.len(), 1);
    }

    #[test]
    fn garbage_file_is_moved_aside_not_deleted() {
        let path = temp_db();
        std::fs::write(
            &path,
            b"definitely not sqlite, just some bytes padding it out to a page",
        )
        .unwrap();
        let s = HistoryStore::open(&path).unwrap();
        assert!(page(&s, None, None, 10).items.is_empty());
        let backed_up = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".bak-"));
        assert!(backed_up);
    }

    #[test]
    fn newer_schema_is_moved_aside() {
        let path = temp_db();
        {
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "user_version", (MIGRATIONS.len() + 1) as i64)
                .unwrap();
        }
        let s = HistoryStore::open(&path).unwrap();
        assert_eq!(s.settings().unwrap(), HistorySettings::default());
        let backed_up = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".bak-"));
        assert!(backed_up);
    }

    #[test]
    fn like_pattern_escapes() {
        assert_eq!(like_pattern(Some(" a_b ")), Some("%a\\_b%".into()));
        assert_eq!(like_pattern(Some("")), None);
        assert_eq!(like_pattern(None), None);
    }
}
