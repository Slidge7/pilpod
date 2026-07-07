# Vault — Test Agent Brief (all 6 phases)

**Your role: run tests only. READ-ONLY. Do NOT edit, create, fix, refactor, or
modify any file — not even to make a failing test pass.** If something fails,
capture the exact output (command, exit code, full error text) and report it.
No fixes of any kind. Your single deliverable is a test report.

Project root: `C:\Users\T14\Desktop\dev\pilpod` (Tauri 2 + React 19 + TS).
The "Vault" feature was implemented across all 6 planned phases. New backend
module: `src-tauri/src/vault/`. New frontend feature: `src/features/vault/`.
Integration points touched: `src-tauri/src/lib.rs`, `src-tauri/src/app/mod.rs`,
`src-tauri/src/app/handlers.rs`, `src-tauri/src/platform/stub_commands.rs`,
`src/features/media-dashboard/MediaDashboard.tsx`, `src/shared/ui/icons.tsx`.

Run each block below from the stated directory. Record command, exit code, and
full output for every one.

---

## 1. Rust — compile & unit tests (from `src-tauri/`)

```
cargo build
cargo test vault::
cargo test
```

- `cargo build` — confirm the whole crate compiles on Windows.
- `cargo test vault::` — the vault module's unit tests only.
- `cargo test` — full suite (confirm nothing else regressed).

Vault Rust tests to expect in the output (all in-module `#[cfg(test)]`):

- `vault::dto::tests` — default version/empty; camelCase round-trip; media-item
  `kind` defaults to `"unknown"`.
- `vault::url::tests` — `matches_shared_vectors`, `idempotent`,
  `query_order_independent` (reads `src-tauri/src/vault/testdata/url_vectors.json`).
- `vault::store::tests` — missing-file→empty; save/load round-trip; no tmp file
  left behind; corrupt-file backup; future-version backup.
- `vault::state::tests` — bookmark add/dedupe (`already_saved`), update patch
  (incl. notes-clear), remove, pinned-then-newest ordering, dirty flag,
  `should_emit`; **playlists**: dedupe pool + append, add-to-missing-playlist
  inserts nothing, idempotent add, orphan GC on remove, media shared by two
  playlists survives one removal, delete playlist GCs media, reorder requires
  same multiset, update playlist patch; **mark_opened** counters; **replace_all**.
- `vault::commands::tests` — url validation, title fallback, tag dedupe.

## 2. Rust — non-Windows compile check (optional but requested by the plan)

If you have a non-Windows target or a WSL/Linux checkout, confirm it still
compiles (the vault is platform-neutral; only `vault_open_entry` is
Windows-gated with a stub in `platform/stub_commands.rs`):

```
cargo check
```

(On a Windows-only setup, skip this and note it was skipped.)

## 3. Frontend — type check (from repo root)

```
npx tsc --noEmit
```

Report every error. Pay special attention to anything under
`src/features/vault/`, `src/features/media-dashboard/MediaDashboard.tsx`, and
`src/shared/ui/icons.tsx`. (If you see errors in unrelated pre-existing files,
report them separately so we can tell them apart from vault work.)

## 4. Frontend — unit tests (from repo root)

```
npm test
```

or specifically:

```
npx vitest run src/features/vault/
```

Vault frontend tests to expect:

- `src/features/vault/lib/__tests__/normalizeUrl.test.ts` — Rust-parity vectors
  (must match the Rust `url::tests` exactly), idempotency, order-independence.
- `src/features/vault/lib/__tests__/vaultSearch.test.ts` — ranking, tag AND
  filter, pinned ordering, tag collection, media search.
- `src/features/vault/lib/__tests__/capture.test.ts` — media-kind derivation,
  bookmark/media capture mapping.
- `src/features/vault/lib/__tests__/_smoke.test.ts` — every vault component
  module resolves and exports a function.

## 5. Manual smoke (only if you can launch the dev build — otherwise skip & note)

```
npm run tauri dev
```

Then, without editing anything, verify and report pass/fail for each:

1. A third **Vault** tab appears next to Media / Download.
2. Bookmarks: "Save an open tab" saves a tab; it appears in the list; the save
   icon shows as saved; search and tag chips filter; pin reorders to top; edit
   (title/tags/notes) persists; remove works.
3. Restart the app — bookmarks and playlists persist (file:
   `%APPDATA%/<app>/vault_store.json`).
4. Playlists: create a playlist; "Now playing / Add to…" adds a currently
   playing media tab; open the playlist; reorder (drag or ↑/↓); remove item;
   rename; delete playlist.
5. Smart open: clicking a saved entry focuses the live tab if open, else opens
   the default browser.
6. Export then Import the vault JSON round-trips.

---

## Report back

For each numbered block: the command(s), exit code(s), and pass/fail counts per
test module, plus verbatim error output for anything that fails or any compiler
warnings. Then **stop — make no changes.**
