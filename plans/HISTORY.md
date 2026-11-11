# History — design notes

PilPod records its own history of **pages visited** and **media played**, built
only from data it already receives. No browser history database is read, and
the companion extension needs no new permission or protocol message.

## Data flow

```
companion ──► bridge ──► browser_detector::emit_browsers_to_ui
                              │  (merged DetectedBrowser list — what the dashboard shows)
                              ├──► browsers://update  (UI)
                              └──► history::observe   (memory only)
                                        │
                              history thread, every 2 s:
                              recorder.sweep → take_writes → SQLite (one transaction)
                                        │
                                        └──► history://changed  (UI re-queries)
```

Only browsers that are **verified** (`activationState == active`) **and
connected** are recorded — the same rows the user can see.

## Modules (`src-tauri/src/history/`)

| File | Role |
| --- | --- |
| `recorder.rs` | Pure state machine: snapshots in, rows out. No I/O, no clock. |
| `service.rs` | Locking + lifecycle (crash repair, heartbeat, retention). Tauri-free. |
| `store.rs` | The only file that touches SQLite. Migrations via `user_version`. |
| `model.rs` | DTOs (mirrored in `src/features/history/types.ts`). |
| `commands.rs` | Thin Tauri commands. |
| `open.rs` | Windows-only "open entry" — via the shared `browser_open` helper. |
| `mod.rs` | Init, feed, exit flush, the tick thread. |

Lock order is always **store → recorder**. `observe` takes only the recorder,
so the bridge thread never waits on disk.

## Recording rules

- **Visit** = one tab on one `http(s)` URL (fragment dropped). Ends on
  navigation or tab close. Title/favicon refresh while open.
- **Media play** = one media identity (URL + title + artist) in one tab, stored
  only after **10 s** of actual playing. Played time excludes pauses and is
  checkpointed every 60 s.
- **Browser disappears** → sessions held for a 20 s grace (socket blips cost
  nothing), then end at the moment it vanished.
- **Resume** → visits ended because the browser left (or PilPod exited) are
  continued by that profile's *arrival* snapshot (session restore / PilPod
  restart) instead of being duplicated. Pages opened later are new visits.
- **Crash** → rows left open are closed at the last heartbeat (≤ 30 s stale).
- **Pause** → open rows close; nothing is recorded until resumed.
- **Delete** → deleted open rows keep being tracked but are never written again.

## Storage

`app_data_dir()/history.sqlite3` (WAL). Keyset pagination on
`(started_at_ms, id)`; search is `LIKE` over title/URL (+ artist/album/page title
for media). Retention defaults to 90 days (purged hourly; open rows never
purged). Corrupt or newer-schema files are moved to `.bak-<ms>`, never deleted.

## UI (`src/features/history/`)

Dock button → `HistoryPanel`: Pages | Media tabs, search, day groups (local
time), infinite scroll, open / remove per row, remove a whole day, settings
(record toggle, retention, clear all).

## Possible next steps

- Site filter chips (top hosts) and per-browser filter.
- "Most played" / time-per-site summaries (all derivable with SQL over the
  existing tables — no recorder change).
- FTS5 index if `LIKE` search ever gets slow (hundreds of thousands of rows).
- Export history alongside the vault backup.
