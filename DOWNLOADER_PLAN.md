# PilPod — Premium Universal Downloader: Implementation Plan

> Status: **COMPLETE — all 5 phases implemented and verified (2026-07-06).**
> Phase 1 ✅ premium gating · Phase 2 ✅ Rust downloader core · Phase 3 ✅ sidecar
> lifecycle (externalBin, no shell plugin — webview cannot spawn processes) ·
> Phase 4 ✅ UI/tab integration · Phase 5 ✅ hardening (crash recovery, retry,
> disk preflight). See `docs/downloader.md` for the as-built reference.
>
> Before production release: (1) replace the DEV `LICENSE_PUBKEY` in
> `src-tauri/src/premium/license.rs` with a production key, (2) install the
> built bundle on a clean Windows VM once, (3) decide on a payment-provider
> integration to replace self-issued licenses (swap `license.rs` only).
> Supersedes/extends `plans/PILPOD_DOWNLOAD_FEATURE_PLAN.md` (that plan had no premium gating and predates the current repo state). Where the two conflict, this document wins.

---

## 0. Current-state findings (repo review)

| Area | Finding | Consequence |
|---|---|---|
| Binaries | `yt-dlp.exe` and `ffmpeg.exe` already exist in `src-tauri/binaries/` but are **not wired** into `tauri.conf.json` (no `externalBin`, no `resources` entry, no shell plugin) | Phase 3 wires them as proper Tauri sidecars |
| Rust layout | Clean per-feature modules (`browser_bridge/`, `audio_mixer/`, `dev_lab/`), all `#[cfg(windows)]`-gated with stubs in `platform/stub_commands.rs` | New `downloader/` and `premium/` modules follow the same pattern |
| Command registration | Centralized in `app/handlers.rs` (`with_invoke_handler`), init in `app/setup.rs` | Two touch points only; no scattering |
| Events | Existing naming convention `gsmtc://`, `browsers://` | Downloader uses `dl://`, premium uses `premium://` |
| Frontend | React 19, no state library, per-feature folders in `src/features/`, hooks-based (`useMediaDashboard` pattern) | `src/features/downloader/` + `useDownloader`/`usePremium` hooks; no new npm deps except Tauri plugin JS bindings |
| Dialog | `tauri-plugin-dialog` installed, `dialog:allow-open` permitted for main window | Directory picker is nearly free |
| Premium/licensing | **Nothing exists** — no license, account, or entitlement code anywhere | Phase 1 builds this from scratch; it's the foundation everything else sits on |
| Window | 350×600, frameless | Downloader UI must fit 350px width |
| Cargo | `tokio` (with `process`), `serde`, `uuid`, `reqwest` (windows-only) already present | New deps: `tauri-plugin-shell`, `ed25519-dalek`, `dirs`; `semver` optional for update checks |

**Module placement:**

```
src-tauri/src/premium/        ← new, platform-neutral (no cfg(windows))
src-tauri/src/downloader/     ← new, #[cfg(windows)] like siblings, stubs for other OS
src/features/downloader/      ← new React feature folder
src/features/premium/         ← new: usePremium hook + gate components (reusable by future premium features)
```

---

## 1. Architecture overview

```
┌────────────────────────── React (350px UI) ──────────────────────────┐
│ PremiumGate ──wraps──> DownloadPanel                                  │
│   usePremium()            UrlInput → FormatPicker → SaveOptions       │
│   (premium://status)      (dir picker + filename) → Queue/Progress    │
└───────────────▲──────────────────────────┬───────────────────────────┘
        events  │ premium:// dl://         │ invoke (dl_*, premium_*)
┌───────────────┴──────────────────────────▼───────────────────────────┐
│ Rust backend (src-tauri)                                              │
│  premium::EntitlementState (managed state, single source of truth)    │
│      └── require_premium() guard — FIRST line of EVERY dl_* command   │
│  downloader::                                                         │
│      commands.rs → state.rs (DownloadManager) → worker.rs             │
│                                    │ spawn/kill                       │
│                          sidecar: yt-dlp ── --ffmpeg-location ──> ffmpeg
└───────────────────────────────────────────────────────────────────────┘
```

Design rules:

1. **Backend is authoritative for premium.** The UI hiding the panel is cosmetic; the real gate is `require_premium()` inside every Rust command. Bypassing the UI (devtools `invoke("dl_start", …)`) still hits the Rust check.
2. **Downloader never imports from browser/media modules** and vice-versa. Its only integration points: `lib.rs` (mod decl), `app/handlers.rs` (command registration), `app/setup.rs` (one init call).
3. **All child-process state lives in Rust.** React can crash/re-render freely; `dl_get_queue` re-hydrates.
4. **Compile-time flag** `feature = "downloader"` in Cargo + `VITE_FEATURE_DOWNLOADER` env flag lets us ship builds with the feature entirely absent, independent of the runtime premium check.

---

## Phase 1 — Premium gating logic

Foundation phase: nothing downloader-specific ships until this passes.

### 1.1 Rust: `src-tauri/src/premium/`

```
mod.rs        — public API: init(), EntitlementState, require_premium()
license.rs    — LicenseFile parsing + Ed25519 signature verification
store.rs      — load/save app_data_dir()/pilpod/license.json (0600-equivalent)
commands.rs   — premium_get_status, premium_activate(key), premium_deactivate
```

- **License format:** JSON payload `{ email, plan, features: ["downloader"], issued_at, expires_at, machine_hint? }` + detached Ed25519 signature. Public key compiled into the binary. Verification is fully offline; issuing happens server-side (out of scope here — Phase 1 ships a keygen dev-tool script so we can self-issue test licenses).
- **`EntitlementState`** = `Arc<RwLock<Entitlement>>` managed via `app.manage()`. Loaded once at startup in `app/setup.rs`, updated on `premium_activate`.
- **`require_premium(state, "downloader") -> Result<(), String>`** — checks flag validity, feature list, expiry with a 72h clock-skew grace window. Every `dl_*` command calls this first.
- Emits `premium://status { active, plan, features, expiresAt }` on startup and on any change.
- Tamper behavior: bad signature / edited payload / expired ⇒ state falls back to Free, no crash, event reflects it.

### 1.2 Frontend: `src/features/premium/`

```
usePremium.ts      — hydrate via premium_get_status, subscribe to premium://status
PremiumGate.tsx    — wrapper: renders children if entitled, else <UpsellPanel/>
UpsellPanel.tsx    — lock icon, feature blurb, license-key input → premium_activate
```

### 1.3 Wiring

- `lib.rs`: `mod premium;` (no cfg — platform-neutral).
- `app/setup.rs`: load license, manage state, emit initial status.
- `app/handlers.rs`: register the 3 premium commands (both windows and non-windows handler lists — these are not Windows-only).
- Cargo: add `ed25519-dalek`, `base64` (present).

### ✅ Phase 1 verification checkpoints (must all pass before Phase 2)

- [ ] `cargo test -p pilpod` — unit tests: valid license verifies; **tampered payload rejected; wrong key rejected; expired rejected; missing file ⇒ Free tier; grace window honored**
- [ ] Dev keygen script issues a test license; `premium_activate` flips state and emits `premium://status` (observed in devtools)
- [ ] Hand-editing `license.json` on disk then restarting ⇒ app reverts to Free, no panic
- [ ] Calling a placeholder gated command via devtools `invoke()` without a license returns `Err("premium_required")`
- [ ] Non-Windows check build (`cargo check --target x86_64-unknown-linux-gnu`) passes
- [ ] Existing app functionality untouched (smoke: browser tabs, mixer, wallpaper)

---

## Phase 2 — Rust downloader core

Pure backend; testable from devtools console before any UI exists. Structure mirrors the prior plan (§4 of `PILPOD_DOWNLOAD_FEATURE_PLAN.md`) with premium + filename additions:

```
src-tauri/src/downloader/
  mod.rs        — init(), re-exports
  state.rs      — DownloadManager { tasks, children }, DownloadTask, DownloadStatus
  formats.rs    — yt-dlp --dump-json parsing → VideoInfo/Format + preset builder
  commands.rs   — all #[tauri::command], each starting with require_premium()
  worker.rs     — spawn, stdout progress parsing, event emission, cancel/kill
  settings.rs   — output_dir, preferred_format, concurrent_limit → download_settings.json
  filename.rs   — sanitize user filename (Windows reserved chars/names, length, path traversal)
```

**Commands** (all premium-gated): `dl_fetch_info(url)`, `dl_start(url, format_id, output_dir, filename, task_id)`, `dl_cancel(task_id)`, `dl_get_queue`, `dl_clear_done`, `dl_get_settings`, `dl_set_settings`, `dl_open_output_dir`, `dl_check_binaries`.

**Format presentation:** parse the raw format list, then emit user-facing presets: Best (video+audio mux), 1080p/720p/480p MP4, Audio-only MP3 / M4A (via `--extract-audio --audio-format`). Raw format list retained behind an "advanced" field.

**Custom filename:** `--output "<dir>/<sanitized>.%(ext)s"`; empty ⇒ `%(title)s`. `filename.rs` strips `\/:*?"<>|`, trims trailing dots/spaces, rejects `CON`/`NUL`/etc., caps at 200 chars, and rejects any path separators (dir comes only from the validated `output_dir`).

**Worker:** `--newline --progress-template "%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s"`, line-buffered stdout → `dl://progress`; `[Merger]` ⇒ Muxing; exit 0 ⇒ `dl://complete`, else `dl://error` with tail of stderr. Cancel = kill child + `taskkill /T` fallback so no orphan ffmpeg remains. Concurrency: `tokio::sync::Semaphore` (default 2).

**Events:** `dl://update`, `dl://progress`, `dl://complete`, `dl://error`, `dl://binary-status`.

**Stubs:** every command mirrored in `platform/stub_commands.rs`.

### ✅ Phase 2 verification checkpoints

- [ ] `cargo test`: formats.rs parses a committed fixture of real `yt-dlp --dump-json` output (YouTube + one non-YouTube site) into correct presets
- [ ] `cargo test`: filename sanitizer property tests (reserved names, traversal `..\\`, unicode, 255-char input)
- [ ] From devtools: `dl_fetch_info` on a YouTube URL returns title + presets in < 10s
- [ ] From devtools: `dl_start` → file appears in chosen dir with chosen name; `dl://progress` events observed streaming
- [ ] `dl_cancel` mid-download: process tree gone (verify via Task Manager — zero `yt-dlp.exe`/`ffmpeg.exe` remain), partial file cleaned
- [ ] Calling any `dl_*` with license removed ⇒ `Err("premium_required")` — **re-verify gating end-to-end**
- [ ] 3 simultaneous `dl_start` ⇒ third stays Queued until a slot frees
- [ ] Non-Windows stub build compiles; existing subsystems regression smoke passes

---

## Phase 3 — Sidecar integration & binary lifecycle

Convert the loose `.exe`s into properly managed Tauri sidecars.

1. Add `tauri-plugin-shell`; rename binaries to target-triple convention (`yt-dlp-x86_64-pc-windows-msvc.exe`, `ffmpeg-x86_64-pc-windows-msvc.exe`) and register under `bundle.externalBin` in `tauri.conf.json`.
2. Capability: sidecar-execute permission scoped to exactly these two binaries, main window only. No generic shell-open/execute permission.
3. `binary.rs` (new file in `downloader/`): resolve sidecar path (dev vs bundled), report versions (`yt-dlp --version`), expose `dl_check_binaries` + `dl_update_ytdlp` (`yt-dlp -U` against a copy in `app_data_dir()/bin/` since bundled resources are read-only — first-run copy step, per the prior plan's Strategy A).
4. `scripts/fetch-binaries.ps1` for contributor bootstrap; `.gitignore` the binaries dir (currently the exes risk being committed — 100MB+ repo bloat).
5. Worker switches from raw `tokio::process` paths to resolved sidecar paths; always pass `--ffmpeg-location` explicitly, never PATH.

### ✅ Phase 3 verification checkpoints

- [ ] `npm run tauri dev`: sidecars resolve and `dl_check_binaries` reports both versions
- [ ] `npm run tauri build` → install the bundle on a clean Windows VM (no yt-dlp/ffmpeg on PATH) → full download succeeds
- [ ] First-run copy to `app_data_dir()/bin/` happens once; second launch skips it
- [ ] `dl_update_ytdlp` updates the managed copy and `dl://binary-status` reflects the new version
- [ ] `git status` confirms no `.exe` tracked; fresh clone + `fetch-binaries.ps1` + build works
- [ ] Capability audit: webview cannot spawn anything except the two allowlisted sidecars

---

## Phase 4 — UI & state management

```
src/features/downloader/
  index.ts
  DownloadPanel.tsx            — mounted as new "download" tab in MediaDashboard header
  components/
    UrlInput.tsx               — paste + Fetch button (+ clipboard read on focus)
    FormatPicker.tsx           — preset dropdown (MP4 1080/720/480, MP3, M4A, Best) + advanced list
    SaveOptions.tsx            — dir picker (tauri-plugin-dialog open({directory:true})) + filename input with live sanitization preview
    DownloadQueue.tsx / DownloadCard.tsx — progress bar, speed/ETA, Cancel/Open/Retry/Remove
    BinaryStatusBanner.tsx     — shown when sidecars missing/outdated
  hooks/useDownloader.ts       — invoke + dl:// listeners, Map<id, DownloadTask>
  types.ts                     — TS mirrors of Rust structs
```

- Tab type extends to `"browser" | "windows" | "download"`; tab button reuses existing header styles; whole panel wrapped in `<PremiumGate feature="downloader">`.
- Flow: paste URL → fetch info (title/thumb/duration) → pick format/quality → pick folder & filename → Download. Defaults persisted via `dl_get_settings`/`dl_set_settings`.
- Behind `VITE_FEATURE_DOWNLOADER` so the tab can be compiled out.
- Fits 350px: single-column, compact cards, matching existing CSS tokens (no new CSS framework).

### ✅ Phase 4 verification checkpoints

- [ ] `npm run test` (vitest): useDownloader reducer logic + filename-preview unit tests
- [ ] Free tier: tab shows UpsellPanel, no dl_* invoke fires (verify via Rust logs); activate license → panel unlocks live without restart
- [ ] Full happy path through UI: paste → presets shown → custom dir + custom name → progress bar animates → Done → "Open file" opens Explorer at the file
- [ ] Error paths render: invalid URL, unsupported site, disk-full/permission-denied dir, cancel mid-run
- [ ] Queue survives React remount (switch tabs during a download, come back — progress intact)
- [ ] No layout overflow at 350×600; existing tabs unaffected
- [ ] `tsc` clean; non-Windows stub build still compiles

---

## Phase 5 — Hardening, E2E & release gate

- Crash recovery: persist active task IDs; on relaunch mark orphans Error, offer Retry.
- Disk-space preflight (< 500MB free ⇒ warn), long-path handling, network-drop mid-download behavior.
- Rate/abuse sanity: cap queue length; debounce fetch_info.
- Docs: update `PilPod_Beta_doc.md` + short `docs/downloader.md`.
- Legal note in UI footer: user is responsible for complying with each site's terms of service and copyright law; feature is for downloading content the user has rights to.

### ✅ Phase 5 verification checkpoints (release gate)

- [ ] E2E matrix on Win 10 1809 + Win 11: YouTube, one audio-only, one non-YouTube site; each as MP4-1080p, MP4-720p, MP3
- [ ] Kill app mid-download → relaunch → task shown as Error, no zombie processes, Retry works
- [ ] 2h soak: repeated downloads, memory of Rust process stable (no leaked Child handles)
- [ ] Full premium regression: expired license mid-session blocks *new* downloads (in-flight allowed to finish), tampered license reverts to Free
- [ ] Full app regression: GSMTC, mixer, browser bridge, wallpaper, dev-lab all unaffected
- [ ] `cargo clippy` + `tsc` + `vitest` + non-Windows check build all green in one run

---

## Rollout order & dependencies

```
Phase 1 (premium) ──► Phase 2 (rust core) ──► Phase 3 (sidecars) ──► Phase 4 (UI) ──► Phase 5 (hardening)
```

Phases 2 and 3 can partially overlap (formats/state work doesn't need sidecar wiring), but each phase's checkpoint list must be fully green before the next phase is declared done.

## Open decisions (need your call before Phase 1)

1. **License issuing**: self-issued Ed25519 licenses (plan above) vs. integrating a payment provider's entitlement API (Lemon Squeezy/Paddle/Stripe) now. Plan assumes self-issued with a dev keygen; a provider can replace `license.rs` later without touching the guard API.
2. **Machine binding**: bind license to a machine fingerprint (stricter, more support burden) or email-only (plan default).
3. **Existing `.exe`s in git**: confirm removal from tracking in Phase 3.
