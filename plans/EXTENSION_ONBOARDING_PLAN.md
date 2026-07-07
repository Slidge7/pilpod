# PilPod — Browser Extension Onboarding & Activation Plan (v2)

> **Goal:** On first launch (and continuously after), PilPod detects installed browsers,
> forces/prompts extension setup per browser via a dynamic 3-step unpacked-install guide,
> and keeps any browser without a verified extension **`inactive`** until setup completes.
>
> **Critical constraint:** The extension lives strictly in `./pilpod-companion` and can
> **not** be hosted on web stores. It is always installed as an **Unpacked Extension**
> via Developer Mode.
>
> **Rule:** Each phase must pass its own tests (`cargo test` + `npm test`) before the next begins.

---

## 0. Current state (verified July 2026)

Already built — this plan reuses, not rebuilds:

| Piece | Where | Status |
|---|---|---|
| OS browser scan (registry + process enum, Windows) | `src-tauri/src/browser_os_scan.rs`, `browser_detector.rs` | ✅ `Vec<DetectedBrowserInfo>` from background thread |
| Browser catalog (id, exe, registry keys, AUMID) | `src-tauri/src/browser_catalog.rs` | ✅ ~40 entries |
| Extension-installed persistence | `ExtensionInstalledStore` → `{app_data}/browser_ext_state.json` | ✅ set on first bridge POST/WS connect |
| Bridge (HTTP :17399, WS :17400) | `src-tauri/src/browser_bridge/` | ✅ marks `extension_installed`, `extension_connected` |
| Peer attribution (which browser connected) | `browser_bridge/peer_pid.rs` | ✅ connecting PID → browser exe |
| Frontend browser feed | `useBrowsers.ts`, `browsers://update` event | ✅ |
| Companion extension (MV3) | `./pilpod-companion` (`manifest.json` at its root — the folder to load unpacked) | ✅ |
| Resource bundling hook | `tauri.conf.json` → `bundle.resources` | ✅ list exists (wallpapers, icons) — extend it |

**Gaps this plan closes:**

1. No explicit **activation state machine** — only booleans on `DetectedBrowser`.
2. No **companion path resolution** — app can't tell the user where `pilpod-companion` is, in dev or production.
3. No **"reveal in Explorer"** or **"open browser's extensions page"** actions.
4. No **onboarding UI / dynamic 3-step guide**; inactive browsers are not gated in the dashboard.

---

## Phase 1 — Activation state machine (Rust core, no UI)

**Objective:** Replace implicit booleans with a typed, persisted per-browser activation state.

### Steps

1. New module `src-tauri/src/browser_activation.rs`:
   ```rust
   pub enum ActivationState {
       Inactive,      // detected, extension never verified
       SetupPending,  // user opened the setup guide; awaiting handshake
       Active,        // extension verified for this browser
       Revoked,       // was Active; extension unseen past grace window
   }
   ```
2. `ActivationStore` (supersedes `ExtensionInstalledStore`): `os_browser_id → { state, first_activated_at, last_verified_at }` persisted to `{app_data}/browser_activation.json`. One-time migration: legacy `browser_ext_state.json` entries with `true` → `Active`.
3. Pure transition function `fn advance(state, event) -> ActivationState` with events: `Detected`, `SetupStarted`, `HandshakeVerified`, `ExtensionLost { grace_expired }`, `SetupCancelled`.
4. Extend `DetectedBrowser` DTO (`browser_dto.rs`) with `activation_state` (camelCase serialized); keep `extension_installed`/`extension_connected` for compatibility.
5. Wire into `build_browsers_payload` in `browser_detector.rs`.

### ✅ Phase 1 testing checkpoint

- Unit tests on `advance()`: full transition table; illegal transitions are no-ops.
- Store round-trip (save → load → equality) + legacy migration test.
- Payload test: browser with no store entry serializes as `"inactive"`.
- Gate: `cargo test` green; `npm test` unaffected.

---

## Phase 2 — Companion directory mapping & browser routing (Rust)

**Objective:** The app knows exactly where `pilpod-companion` is, can reveal it in the OS file explorer, and can open the correct extensions dashboard in any detected browser.

### Steps

1. **Path resolution** — new module `src-tauri/src/companion_locator.rs`:
   - **Production:** bundle `pilpod-companion` as a Tauri resource — add to `tauri.conf.json` `bundle.resources` (only what the browser needs: `manifest.json`, `dist/*`, `icons/*`, `src/*` per manifest references — exclude `node_modules`, `newui`, tests). Resolve via `app.path().resource_dir().join("pilpod-companion")`.
   - **Dev:** walk up from the executable/CWD to find the repo's `pilpod-companion` (marker: `manifest.json` with `"name": "PilPod Companion"`).
   - Validation: `companion_dir_is_valid(path) -> bool` (manifest exists + parses + name matches). Return a typed error if unresolvable.
2. **Catalog routing metadata** — extend `BrowserCatalogEntry` in `browser_catalog.rs`:
   - `engine: EngineFamily` (`Chromium | Gecko | Other`)
   - `extensions_page: Option<&str>` — `"chrome://extensions"`, `"edge://extensions"`, `"brave://extensions"`, `"opera://extensions"`, `"vivaldi://extensions"`, etc.; Gecko → `"about:debugging#/runtime/this-firefox"`; `None` = unsupported.
3. **Tauri commands** (new `activation_commands.rs`, registered in `lib.rs`):
   - `get_activation_overview()` → detected browsers + activation state + engine + whether routing is supported.
   - `get_companion_path()` → absolute path string (for display in the guide).
   - `reveal_companion_folder()` → opens native file explorer at the **parent** directory with `pilpod-companion` selected (Windows: `explorer /select,"<path>"`; keep the call behind a small `Platform` trait for future macOS `open -R`).
   - `open_extensions_page(os_browser_id)` → launches that browser's exe (path already known from the OS scan/registry) with the `extensions_page` URL as argument; sets state → `SetupPending` via `advance(SetupStarted)`.
   - `cancel_browser_setup(os_browser_id)`, `reset_browser_activation(os_browser_id)` (dev-lab).
   - Launch/reveal side-effects go behind a trait so tests inject a mock launcher.

> **Note (needs product decision, flagged in Open Questions):** Gecko/Firefox unpacked
> extensions are *temporary* — they unload on browser restart. Chromium unpacked
> extensions persist. Plan ships Chromium-family as first-class; Firefox is either
> excluded from activation or shown with a "reactivate after every restart" warning.

### ✅ Phase 2 testing checkpoint

- `companion_locator` tests: dev resolution against the real repo folder; validation rejects a folder without a matching manifest; typed error on missing.
- Catalog tests: every `Chromium`-engine entry has an `extensions_page`; URL scheme matches the browser id (e.g. `edge` → `edge://`).
- Command tests with mock launcher: `open_extensions_page("chrome")` invokes chrome exe with `chrome://extensions` arg and state becomes `SetupPending`; unknown id → typed error, state untouched; `reveal_companion_folder` passes the resolved path to `explorer /select`.
- Bundle smoke check: `npm run tauri build` (or `cargo tauri build --debug`) output contains `pilpod-companion/manifest.json` in resources.
- Gate: `cargo test` green.

---

## Phase 3 — Verified handshake attribution (bridge)

**Objective:** When the extension connects, prove *which* browser it is and flip exactly that browser `SetupPending/Inactive → Active`. This is what makes guide STEP 3 automatic.

### Steps

1. On WS connect / first POST, resolve peer PID → process exe → `os_browser_id` (extend `peer_pid.rs`, map exe via catalog; handle ambiguous exes like `browser.exe` with path markers).
2. On successful attribution: `advance(state, HandshakeVerified)` → `Active`, persist, `emit_browsers_to_ui` immediately (the UI's "Verify Connection" step reacts live).
3. Attribution failure (unknown exe): keep state, log with context — fail closed, never activate the wrong browser.
4. Revocation sweep in the detector loop: `Active` browser with no slot/heartbeat past `SLOT_GC_SECS` and extension UUID gone → `Revoked`. Grace window (`RUNNING_GRACE_SECS`, reconnecting set) prevents flap on restarts/sleep.

### ✅ Phase 3 testing checkpoint

- Attribution unit tests: exe → os_browser_id incl. ambiguity cases.
- Simulated handshake (`scripts/dev-sim-profiles.mjs` sim profiles) flips exactly one browser to `Active`; others untouched.
- Revocation fake-clock tests: grace window honored; sleep/resume does **not** revoke.
- Gate: `cargo test` green; manual smoke — load unpacked in a real Chromium browser, watch state flip without app restart.

---

## Phase 4 — Onboarding UI: dynamic 3-step guide + dashboard gating (React)

**Objective:** First-run flow prompts setup per browser; the guide shows the exact steps for *that* browser; inactive browsers are locked in the dashboard.

### Steps

1. New feature `src/features/onboarding/`:
   - `useActivation.ts` — wraps `get_activation_overview` + live `browsers://update`.
   - `OnboardingGate.tsx` — shown when ≥1 detected browser is not `Active` and onboarding not completed/dismissed (persisted via a small Tauri `ui_state` command, **not** localStorage).
   - `BrowserSetupCard.tsx` — per-browser row: icon, name, state badge (`Inactive` / `Setting up…` / `Active` / `Reconnect needed`), **Activate** button → opens `SetupGuide` for that browser.
2. `SetupGuide.tsx` — full-page dynamic guide, content keyed by `engine` + `os_browser_id`:
   - **Header actions:** companion path display (from `get_companion_path`) + **"Show folder"** button → `reveal_companion_folder()`; **"Open <Browser>'s extensions page"** button → `open_extensions_page(id)`.
   - **STEP 1 — "Enable Developer Mode":** visual (SVG/screenshot asset per engine) of the Developer-mode toggle, annotated top-right for Chromium; Edge variant notes its left-sidebar placement.
   - **STEP 2 — "Load the Companion":** two equal paths — *drag & drop the `pilpod-companion` folder into the extensions page*, **or** *click "Load unpacked" and select the folder*. Folder name shown verbatim with a copy-path button.
   - **STEP 3 — "Verify Connection":** "Return to PilPod" panel with a live status indicator driven by `browsers://update`; on `Active` it auto-advances to a success screen (no manual confirm). Timeout hint after ~60 s ("Still waiting — check the extension loaded without errors").
   - Guide variants: `chromium` (default), per-browser overrides where UI differs (Edge, Opera), `gecko` (about:debugging + temporary-addon warning) if Firefox stays in scope.
3. **Dashboard gating** in `MediaDashboard`: browsers not `Active` render as locked placeholder rows ("Setup required" + Activate → SetupGuide); tabs/media/audio features disabled for them. Reuse existing placeholder-row path in `build_browsers_payload`.
4. Route in `App.tsx`: main window wraps `MediaDashboard` in `OnboardingGate`.
5. Policy: `force` on first run (modal until ≥1 browser Active or explicit per-browser "Skip for now"); skipped browsers stay visibly locked.

### ✅ Phase 4 testing checkpoint

- Vitest: guide-variant selection (`chrome` → chromium steps + `chrome://extensions` label; `msedge` → edge override; unknown engine → generic fallback).
- Vitest: STEP 3 auto-advance — mocked `browsers://update` flipping to `active` transitions the guide to success exactly once.
- Vitest: gate visibility matrix (all-active / some-inactive / skipped) and locked-row rendering (no tab rows for inactive browsers).
- Command wiring: buttons invoke `reveal_companion_folder` / `open_extensions_page` with correct ids (mocked `invoke`).
- Gate: `npm test` + `cargo test` green; `npm run build` (tsc) clean.

---

## Phase 5 — Continuous enforcement & edge cases

**Objective:** The inactive-until-verified invariant holds forever, not just at first run.

### Steps

1. Browser installed *after* onboarding → appears `Inactive`, locked row + non-modal prompt suggesting activation.
2. `Revoked` (extension removed/disabled) re-prompts identically; badge copy: "Extension disconnected — reactivate".
3. Multi-profile: activation is per `os_browser_id`; any verified profile activates the browser (documented decision).
4. Dev-lab panel: view/force activation states, clear store, simulate revocation, re-run companion path resolution — manual QA harness.
5. Debounce: state changes flow through existing `browsers://update` only on real change (`browsersEqual` path).

### ✅ Phase 5 testing checkpoint

- Rust: detector-loop test — browser detected mid-run → `inactive` row in next payload.
- Rust: `Revoked` → handshake → `Active` again; `first_activated_at` preserved.
- Vitest: new-browser prompt fires once, not per update tick.
- Gate: `cargo test` + `npm test` green.

---

## Phase 6 — End-to-end verification & regression

**Objective:** Prove the whole flow on a real machine before merge.

### Steps

1. Add `plans/EXTENSION_ONBOARDING_QA.md` manual checklist:
   - Fresh install (delete `browser_activation.json`) → onboarding lists every installed browser as inactive.
   - "Show folder" opens Explorer with `pilpod-companion` selected — in **dev** and in a **packaged build** (resource dir).
   - "Open extensions page" lands on `chrome://extensions` / `edge://extensions` in the right browser.
   - Full guide walkthrough in Chrome and Edge: Developer mode → Load unpacked (both drag-drop and button paths) → return to app → row flips Active automatically.
   - Second browser stays locked in dashboard until activated.
   - Remove extension from Chrome → after GC window, row shows Revoked and re-locks.
   - Legacy migration: seed old `browser_ext_state.json` → browsers come up Active.
   - Packaged-build check: bundled companion folder loads unpacked successfully (no missing files vs. repo folder).
2. Update `plans/BROWSER_IDENTITY_REGRESSION_CHECKLIST.md` with activation cases.
3. Full suite: `cargo test`, `npm test`, `npm run build`, `cargo clippy -- -D warnings`.

### ✅ Exit criteria

- Detection ✅ · forced setup ✅ · inactive-until-verified ✅ · folder reveal ✅ · browser routing ✅ · dynamic 3-step guide ✅.
- Zero regressions on existing bridge/detector tests.

---

## File-touch summary

| Phase | New | Modified |
|---|---|---|
| 1 | `browser_activation.rs` | `browser_dto.rs`, `browser_detector.rs`, `lib.rs` |
| 2 | `companion_locator.rs`, `activation_commands.rs` | `browser_catalog.rs`, `tauri.conf.json`, `app/setup.rs`, `Cargo.toml` (opener plugin if used) |
| 3 | — | `browser_bridge/peer_pid.rs`, `handler.rs`/`ws.rs`, `browser_detector.rs` |
| 4 | `src/features/onboarding/*` (Gate, SetupCard, SetupGuide, useActivation, guide assets) | `App.tsx`, `MediaDashboard.tsx`, `types/media.ts` |
| 5 | dev-lab activation panel | detector loop, toast plumbing |
| 6 | `EXTENSION_ONBOARDING_QA.md` | regression checklist |

## Open questions (need your call before Phase 2)

1. **Firefox/Gecko scope:** unpacked add-ons in Firefox are *temporary* (unload on every browser restart). Include Firefox with a "reactivate each restart" warning, or exclude Gecko browsers from activation for now (recommended)?
2. **Bundled resource contents:** confirm which companion subfolders a working unpacked install needs (`manifest.json`, `dist/`, `icons/`, `src/`?) so the bundle stays lean — I'll verify against `manifest.json` references in Phase 2.
3. **Force policy confirmed?** Plan assumes hard-block first-run modal with per-browser "Skip for now". OK?
