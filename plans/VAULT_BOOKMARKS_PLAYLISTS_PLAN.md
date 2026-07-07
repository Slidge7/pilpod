# PilPod — Vault: Bookmarks & Media Playlists Implementation Plan

> **For the AI implementing this:** PilPod is an existing Tauri 2 + React 19 + TypeScript
> Windows desktop app. This plan adds a new **Vault** module: manual tab bookmarks plus
> media playlists built from tabs that are actively playing audio/video. It is written
> strictly against the current codebase structure. Read every section before writing code.
>
> **Explicit non-goals:** general tab navigation history (excluded by design), cloud sync,
> accounts, cross-device anything. Local-only, offline-only.

---

## 1. Goal

Two user-facing capabilities, one module:

1. **Modern Bookmarks** — save any tab from the dashboard into a centralized, premium-feeling
   local vault. Fast search, pin, tags, one-click smart open.
2. **Media Playlists** — save tabs that are currently playing audio/video (per `TabMedia`
   metadata from the companion) into named playlists ("Coding Beats", "Podcasts"), with
   artwork, artist/title, duration, ordering, and one-click resume.

---

## 2. Constraints and rules (match existing engineering standards)

- All new Rust code lives in a new module **`src-tauri/src/vault/`**, mirroring the
  downloader's isolation contract (see `downloader/mod.rs` header): integration points are
  exactly `lib.rs` (mod decl), `app/handlers.rs` (command registration), and `app/setup.rs`
  (init call). The vault must **never import from** `browser_bridge`, `browser_tabs`,
  `downloader`, or `audio_mixer` internals — with one deliberate, documented exception in
  Phase 5 (smart open, via a narrow seam described there).
- All new React code lives in **`src/features/vault/`**, following the existing feature
  convention: `components/`, `hooks/`, `lib/`, `types.ts`, `index.ts`, per-component CSS.
- **No new heavyweight dependencies.** Persistence uses serde + JSON files in
  `app_data_dir()`, exactly like `downloader/persistence.rs` (`download_state.json`) and
  `premium/store.rs` (`license.json`). No SQLite (rationale in §3). Zero new crates —
  `uuid` (v4) is already a dependency; use it for ids.
- **Non-Windows builds must compile:** every new `#[tauri::command]` gets a stub in
  `platform/stub_commands.rs`. Note the vault itself is platform-neutral (pure file I/O),
  so prefer compiling the module on all platforms and only stubbing the Windows-dependent
  Phase 5 open command.
- **Do not change** the 350×600 main window; all vault UI must work at 350 px width and
  inside the existing tab-switcher layout in `MediaDashboard.tsx`.
- Match the `--pilpod-*` design tokens in `src/index.css`, the `pilpod-*` class conventions,
  and the glass system (`shared/ui/glass-appearance.css` `::after` underlay pattern).
  No CSS frameworks. New icons go in `shared/ui/icons.tsx`.
- Rust events are namespaced per the existing scheme: **`vault://update`** (like
  `dl://update`, `premium://status`, `browsers://update`). Never emit while holding a lock
  (rule documented in `downloader/state.rs`); diff-before-emit like `browser_tabs.rs`.
- Commands are prefixed **`vault_*`** (like `dl_*`, `premium_*`).
- Tests: Rust unit tests in-module (`#[cfg(test)]`), frontend logic tests colocated under
  `lib/__tests__/*.test.ts` (vitest), matching `media-dashboard/lib/__tests__/` and
  `downloader/lib.test.ts`.

---

## 3. Architectural decisions

### 3.1 Storage: versioned JSON file, in-memory source of truth

**Decision:** single `app_data_dir()/vault_store.json`, loaded fully into an in-memory
`VaultState` at startup; all reads served from memory; writes are debounced atomic
file snapshots.

Rationale:

- The codebase has **zero database dependencies** — every persisted artifact today is a
  small serde JSON file (`download_state.json`, `license.json`, profile-order file). A
  bookmark vault at realistic scale (hundreds to low tens of thousands of entries, each
  < 1 KB) serializes in single-digit milliseconds. SQLite would add a native dependency,
  migration tooling, and a second persistence idiom for no measurable win at this scale.
- "Blazing fast" is achieved by never touching disk on the read path: the frontend holds a
  hydrated snapshot (hook pattern, §5.2) and the backend answers from `Arc<Mutex<VaultState>>`.
- **Escape hatch:** all file access goes through a private `store.rs` with a narrow API
  (`load() -> VaultData`, `save(&VaultData)`). If the dataset ever outgrows JSON, swapping
  `store.rs` for a SQLite-backed implementation touches nothing else.

Write discipline (this is the part that keeps it fast and safe):

- **Atomic writes:** write to `vault_store.json.tmp`, then rename over the original.
  (Improvement over the downloader's direct `fs::write` — bookmarks are user data;
  a crash mid-write must not lose the vault.)
- **Debounced persist:** mutations mark the state dirty and schedule a save ~500 ms later
  on a background thread (coalescing bursts like playlist reordering). Flush immediately
  on exit by adding a `tauri::RunEvent::Exit` arm to the existing run closure in
  `app/mod.rs` (it currently only handles `RunEvent::Ready`).
- **Corruption policy:** like `persistence.rs` — corrupt file logs a warning and starts
  empty, but *first* renames the corrupt file to `vault_store.json.bak-<ts>` so user data
  is never silently destroyed (stricter than the downloader queue, which is disposable).

### 3.2 Data model: bookmarks and media items are separate pools; playlists reference by id

Bookmarks (generic pages) and media items (rich playback metadata) have different shapes
and lifecycles, so they are distinct collections. Playlists hold **ordered lists of media
item ids**, referencing a deduplicated media-item pool — the same track can live in
several playlists without duplicating metadata, and editing metadata fixes it everywhere.

Deduplication key: `normalized_url` (lowercased host, stripped tracking params, stable
ordering of remaining query params — implemented in `vault/url.rs`, mirrored in
`src/features/vault/lib/normalizeUrl.ts` with a shared test-vector file so both sides agree).

### 3.3 Opening saved entries: "smart open" with a graceful fallback

The bridge protocol (`browser_bridge/protocol/frames.rs` → `MediaAction`) has **no
openUrl/createTab action** — the companion can only act on existing tabs. Therefore:

1. **Focus if live:** if a currently synced tab (from `BrowserSlotsMap`) matches the entry's
   `normalized_url`, enqueue the existing `focusTab` command path (which already handles
   OS-level window raising via `browser_focus_win`). Zero protocol changes.
2. **Fallback — open in default browser:** `ShellExecuteW`-style open of the URL (Windows).
   The tab then appears in the dashboard organically once the companion syncs it.
3. **Deferred (explicitly out of scope for v1):** a protocol-level `openUrl` action targeting
   a specific browser/profile. Requires a companion + protocol version bump; noted in §8.

### 3.4 Event and hydration contract

One event, full snapshot: `vault://update` carries the complete serialized vault
(camelCase DTO). At vault scale a full snapshot is small, and it eliminates an entire
class of partial-update bugs; this matches `browsers://update` (full payload) rather than
the downloader's per-task deltas. Emit only when a content hash changes
(diff-before-emit, as in `browser_tabs.rs`). Frontend hydrates on mount via
`vault_get_state` and then trusts events — Rust is the source of truth, exactly like
`useDownloader`.

---

## 4. Database schema (JSON store, version 1)

```jsonc
// app_data_dir()/vault_store.json
{
  "version": 1,
  "bookmarks": [
    {
      "id": "b_9f4c…",              // uuid v4, "b_" prefix
      "url": "https://…",
      "normalizedUrl": "…",          // dedupe + live-tab matching key
      "title": "…",                  // captured from tab; user-editable
      "faviconUrl": "https://…",     // remote URL v1; cached blob in Phase 6
      "sourceOsBrowserId": "chrome", // provenance (DetectedBrowser.osBrowserId)
      "sourceProfileLabel": null,
      "createdAtMs": 0,
      "lastOpenedAtMs": null,
      "openCount": 0,
      "pinned": false,
      "tags": ["docs", "rust"],
      "notes": null
    }
  ],
  "mediaItems": [
    {
      "id": "m_31ab…",
      "url": "https://…",
      "normalizedUrl": "…",
      "pageTitle": "…",              // BrowserTab.title
      "mediaTitle": "…",             // TabMedia.title (nullable)
      "artist": null,                // TabMedia.artist
      "album": null,
      "artworkUrl": null,            // TabMedia.artworkUrl (remote; cached Phase 6)
      "durationSecs": null,          // TabMedia.duration
      "mediaMatchRule": null,        // TabMedia.mediaMatchRule (e.g. "youtube-watch")
      "kind": "unknown",             // "video" | "audio" | "unknown" — derived from
                                      // mediaUrlRules classification at save time
      "sourceOsBrowserId": "chrome",
      "addedAtMs": 0,
      "lastPlayedAtMs": null,
      "playCount": 0
    }
  ],
  "playlists": [
    {
      "id": "p_77de…",
      "name": "Coding Beats",
      "emoji": null,                 // optional glyph shown in list rows
      "createdAtMs": 0,
      "updatedAtMs": 0,
      "itemIds": ["m_31ab…"]         // ordered; ids into mediaItems
    }
  ]
}
```

Integrity rules (enforced in `state.rs`, unit-tested):

- `itemIds` entries must exist in `mediaItems`; deleting a media item removes it from all
  playlists atomically; a media item referenced by zero playlists is garbage-collected.
- Adding a media item whose `normalizedUrl` already exists in the pool reuses (and
  metadata-refreshes) the existing item instead of inserting a duplicate.
- Bookmark adds with a duplicate `normalizedUrl` are rejected with a typed error the UI
  turns into "Already saved" (and highlights the existing entry).
- `version` gates migrations: unknown higher version ⇒ back up file, start empty, warn.

---

## 5. Module layout

### 5.1 Backend — `src-tauri/src/vault/`

```
vault/
├── mod.rs          // module docs (isolation contract), event consts, init()
├── state.rs        // VaultState (Arc<Mutex<VaultData>> + dirty flag), all mutations,
│                   //   integrity rules, content hash for diff-before-emit
├── store.rs        // load/save: atomic tmp+rename, corruption backup, versioning
├── dto.rs          // serde DTOs, #[serde(rename_all = "camelCase")]
├── url.rs          // normalize_url() + shared test vectors
├── commands.rs     // all #[tauri::command] fns; thin: validate → state → emit
└── open.rs         // Phase 5 only, #[cfg(windows)]: smart-open resolution
```

- `mod.rs` header documents the isolation contract verbatim, like `downloader/mod.rs`.
- Event constants: `pub const EVT_UPDATE: &str = "vault://update";`.
- `init(app)` (called from `app/setup.rs` — and, since the vault is platform-neutral,
  from the non-Windows path in `app/mod.rs`'s setup closure alongside `premium::init`):
  load store → `app.manage(VaultStateHandle)` → emit initial snapshot.
- Commands (registered in `app/handlers.rs`):

| Command | Args → Result |
|---|---|
| `vault_get_state` | → full `VaultData` DTO |
| `vault_add_bookmark` | captured-tab payload → new id / `already_saved` error |
| `vault_update_bookmark` | id + patch (title/pinned/tags/notes) |
| `vault_remove_bookmark` | id |
| `vault_create_playlist` | name, emoji? → id |
| `vault_update_playlist` | id + patch (name/emoji) |
| `vault_delete_playlist` | id |
| `vault_add_media_to_playlist` | playlist id + captured-tab-media payload → item id |
| `vault_remove_from_playlist` | playlist id + item id |
| `vault_reorder_playlist` | playlist id + full ordered itemIds |
| `vault_open_entry` (Phase 5) | url + normalizedUrl → `focused` \| `launched` |

  Capture payloads are sent **from the frontend** (it already holds `BrowserTab` +
  `TabMedia` + `DetectedBrowser` from `browsers://update`) — the vault backend never
  reaches into `BrowserSlotsMap` to look tabs up, preserving decoupling.

### 5.2 Frontend — `src/features/vault/`

```
vault/
├── index.ts                    // exports + VAULT_UI_ENABLED compile-time flag
│                               //   (VITE_FEATURE_VAULT, mirroring DOWNLOADER_UI_ENABLED)
├── types.ts                    // DTOs + VAULT_EVENTS const (camelCase mirror of dto.rs)
├── VaultPanel.tsx / .css       // top-level panel: Bookmarks | Playlists sub-views
├── hooks/
│   └── useVault.ts             // the one stateful hook (pattern: useDownloader):
│                               //   listen vault://update, hydrate via vault_get_state,
│                               //   alive-ref guard, memoized savedUrlSet for O(1)
│                               //   "is this tab saved?" lookups, all mutation callbacks
├── lib/
│   ├── normalizeUrl.ts         // mirrors vault/url.rs; shared test vectors
│   ├── capture.ts              // BrowserTab+DetectedBrowser → capture payloads
│   ├── vaultSearch.ts          // in-memory filter/rank (title/url/tags/artist)
│   └── __tests__/…
└── components/
    ├── BookmarkList.tsx / BookmarkRow.tsx     // pinned first, search box, tag chips
    ├── PlaylistList.tsx / PlaylistDetail.tsx  // list → detail; reorder (same pointer-
    │                                          //   drag conventions as existing rows)
    ├── SaveTabButton.tsx                      // bookmark toggle for tab rows
    ├── AddToPlaylistMenu.tsx                  // popover: playlist list + inline create
    │                                          //   (float-menu styling from
    │                                          //   pilpod-media-item__body-menu)
    └── EmptyState.tsx
```

### 5.3 UI integration points (exact touch list)

1. **`MediaDashboard.tsx`** — extend `activeTab` union to `"media" | "download" | "vault"`;
   add a third `role="tab"` button to the existing `pilpod-dl-tabs` tablist (gate on
   `VAULT_UI_ENABLED`); render `<VaultPanel/>` in `<main>`. Consider renaming the tablist
   class to `pilpod-view-tabs` in a mechanical follow-up — not required.
2. **`useVault` mounted once** in `MediaDashboard` and passed down (matching how
   `useMediaDashboard` state flows down), so tab rows and media cards share one snapshot.
3. **Save affordances:**
   - `UnifiedTabRow` / `BrowserTabRow` / `AllTabRow`: add `SaveTabButton` (bookmark icon,
     filled when `savedUrlSet.has(normalizedUrl)`; click toggles save/remove).
   - `MediaItemCard` (and `ActiveMediaStrip` rows): add "Add to playlist" action opening
     `AddToPlaylistMenu`. Only rendered when the tab has `media` (i.e. it appears via
     `collectActiveMediaTabs`) — this is the "actively playing" gate the feature requires.
4. **`shared/ui/icons.tsx`**: `IconBookmark`, `IconBookmarkFilled`, `IconPlaylistAdd`,
   `IconMusicNote` (match existing stroke style).
5. **Glass:** add the new float surfaces (vault rows, playlist menu) to the selector lists
   in `glass-appearance.css` so the opaque-underlay fallback works at low glass strength.
6. **Widget** (`WidgetMediaPanel`): untouched in v1 (noted as future work, §8).

---

## 6. Phased execution plan

Each phase compiles, passes tests, and is shippable behind `VITE_FEATURE_VAULT=false`.

### Phase 1 — Backend vault core (bookmarks only)
- Create `vault/` module: `dto.rs`, `url.rs` (+ test vectors), `store.rs` (atomic write,
  corruption backup, version gate), `state.rs` (mutations, integrity, hash), `mod.rs` init.
- Commands: `vault_get_state`, `vault_add_bookmark`, `vault_update_bookmark`,
  `vault_remove_bookmark`. Register in `app/handlers.rs`; init in setup closure; stubs in
  `platform/stub_commands.rs` if the module stays Windows-gated (prefer platform-neutral).
- Emit `vault://update` after every successful mutation (post-lock, diff-before-emit).
- Debounced persist thread + exit flush.
- **Tests:** normalization vectors; dedupe rejection; corrupt-file backup path; atomic
  write (tmp cleanup); mutation → hash change → single emit.
- **Done when:** `cargo test` green on Windows + a non-Windows check build; manual invoke
  round-trip from devtools works.

### Phase 2 — Frontend foundation + bookmarks UI
- Scaffold `src/features/vault/`; `types.ts`, `useVault`, `normalizeUrl.ts` (+ mirrored
  vectors), `capture.ts`, `vaultSearch.ts`.
- Third dashboard tab + `VaultPanel` with Bookmarks view: search, pinned-first list,
  row actions (open→Phase 5 placeholder = fallback launch only if trivial, else disabled
  tooltip; pin; edit tags; remove).
- `SaveTabButton` wired into the three tab-row components; saved-state indicator.
- CSS per conventions; glass selector additions; empty states.
- **Tests:** vaultSearch ranking; capture mapping; normalizeUrl parity with Rust vectors.
- **Done when:** save/unsave from any tab row survives app restart; UI at 350 px is clean
  in light/dark and across glass strengths.

### Phase 3 — Media playlists backend
- Extend `dto.rs`/`state.rs` with `mediaItems` + `playlists` (schema §4) — still version 1
  (additive fields before first release; if Phase 1 already shipped, bump to version 2 with
  a trivial migration).
- Commands: the six playlist/media commands from §5.1.
- Integrity rules + orphan GC, unit-tested; metadata refresh on duplicate add.
- **Done when:** full playlist CRUD via devtools invokes; store file round-trips.

### Phase 4 — Playlist UI
- `AddToPlaylistMenu` on `MediaItemCard`/`ActiveMediaStrip` (playing tabs only): pick
  playlist or create inline; capture `TabMedia` metadata via `capture.ts`.
- `PlaylistList` + `PlaylistDetail`: artwork thumbs (remote URL, letter-tile fallback like
  existing thumb components), artist/title/duration, drag reorder → `vault_reorder_playlist`.
- **Done when:** "playing tab → Coding Beats → visible with artwork → reorder → restart →
  intact" flows end-to-end.

### Phase 5 — Smart open
- `vault/open.rs` (`#[cfg(windows)]`): `vault_open_entry` — resolve `normalizedUrl` against
  live tabs, focus via the existing `focusTab` enqueue path if matched, else shell-open the
  URL in the default browser. **Documented seam:** `open.rs` is the only vault file allowed
  to call into `browser_tabs`/`browser_commands` helpers; keep it one function deep.
- Update `lastOpenedAtMs`/`openCount`/`lastPlayedAtMs`/`playCount`; stub for non-Windows.
- Wire row/card click-to-open in both views; pending state via the existing
  `browserPendingKeys`-style pattern.
- **Tests:** URL→live-tab matching (table-driven against fabricated slots).
- **Done when:** opening a saved YouTube entry focuses the live tab when present, launches
  the default browser when not.

### Phase 6 — Polish & hardening
- **Artwork/favicon cache:** background fetch to `app_data_dir()/vault/art/<hash>` with
  remote-URL fallback (remote artwork links rot; the vault should feel permanent).
- Bookmark tag-filter chips; playlist totals (count, summed duration).
- Import/export: `vault_export`/`vault_import` to a user-chosen JSON file via the existing
  `tauri-plugin-dialog` (backup story for a local-only feature).
- Perf validation: seed 5 000 bookmarks + 100 playlists; assert snapshot emit < 5 ms,
  search < 5 ms, cold load < 50 ms; add list virtualization only if these fail.
- Optional premium gating decision (mechanism exists: `PremiumGate`/`require_premium()`);
  default: vault is free.
- Final pass: module doc headers, README note, CHANGELOG.

---

## 7. Performance & decoupling summary

- Read path never touches disk; write path is debounced + atomic; events are hashed
  full snapshots — same discipline as the tab pipeline.
- Vault backend knows nothing about browsers except the provenance strings the frontend
  hands it; the single Phase 5 seam is isolated in one file.
- The store swap seam (`store.rs`) future-proofs scale without committing to SQLite today.

## 8. Deferred / future work (explicitly out of v1)

- Protocol `openUrl` action (targeted browser/profile open + companion version bump).
- Widget-mode playlist quick-access; "play whole playlist" sequencing.
- Navigation history — **out of scope permanently for this module** per product decision.
