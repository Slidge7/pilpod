# Extension Setup — Handoff

**Read this file first. Do not re-read the whole module to get oriented.**
Companion docs: `EXTENSION_SETUP_PLAN.md` (design + build log),
`EXTENSION_SETUP_QA.md` (manual test script).
`EXTENSION_ONBOARDING_PLAN.md` is **superseded** — ignore it.

---

## Status: code complete, unverified on real browsers

| Gate | State |
|---|---|
| `cargo test --manifest-path src-tauri\Cargo.toml --lib` | 289 pass |
| `npm test` | 161 pass |
| `npx tsc --noEmit` / `npm run build` | clean |
| `cargo clippy -- -D warnings` | **fails: 17 pre-existing errors, none in this module** |
| Manual QA (`EXTENSION_SETUP_QA.md`) | **not started** ← next job |

Nothing here has met a real browser. Every remaining risk is in QA sections
**D** (attribution), **B8** (empty browser), **C** (Edge), **E2/E3** (revocation).

---

## What this feature does

Companion extension is an **unlisted Chrome Web Store item**,
id `ooogjmdnagfepkocppnldkafbcbmdhal`. Install is one click from a URL — there
is no Developer Mode, no unpacked folder, no bundled extension.

```
first launch → OS scan finds browsers → all Inactive → gate lists them
  → user picks one → we launch THAT browser's exe at the store listing
  → they click Add → extension connects to bridge
  → peer-PID says which browser it was → that browser flips Active
  → its dashboard row unlocks
```

---

## Where things live

**Rust — `src-tauri/src/extension_setup/`**

| File | Role |
|---|---|
| `config.rs` | Extension id + store URLs. Changing the published item = edit here only. |
| `activation.rs` | 5-state machine, `advance(state, event)`. Pure, total. |
| `store.rs` | `browser_activation.json` persistence + legacy migration. Framework-free. |
| `engine.rs` | Per-browser store capability table (13 rows). |
| `launcher.rs` | `BrowserOps` trait + `SystemOps` + `MockOps`. |
| `service.rs` | All decisions. Test everything here. |
| `verify.rs` | `ActivationSnapshot` + revocation rules. |
| `commands.rs` | Tauri wrappers. No logic — nothing to test. |

**Frontend — `src/features/extension-setup/`**

| Path | Role |
|---|---|
| `guides/*.ts` | Instructions as **typed data**, not JSX. `chromium` / `edge` / `opera` / `unsupported`. |
| `guides/index.ts` | `guideFor()` resolver + `{placeholder}` interpolation. |
| `lib/status.ts` | Badge copy, button copy, diagnosis. All wording decisions. |
| `lib/gate.ts` | When the first-run gate shows; lock rule. |
| `hooks/useExtensionSetup.ts` | Commands + live refresh on `browsers://update`. |
| `ExtensionSetupPanel.tsx` | The section. Same component the gate wraps. |
| `OnboardingGate.tsx` | First-run overlay. |

**Integration points (the whole coupling surface):**
`lib.rs` · `app/setup.rs` · `app/handlers.rs` · `browser_dto.rs`
(`activationState` field) · `browser_detector.rs` · `browser_bridge/{handler,ws}.rs`
· `MediaDashboard.tsx` · `SlideMenu.tsx` · `BrowserSessionsPanel.tsx`

---

## Reuses existing browser code — do not rebuild

Detection is entirely pre-existing. The module imports exactly five things:

```
browser_detector::build_detected_browsers()      which browsers exist
browser_catalog::CATALOG                          the 13-browser list
browser_catalog::resolve_exe_path()               path to a browser exe
browser_icon::data_url_for_browser()              icons
browser_os_scan::scan_os_extension_installed()    companion files on disk
```

plus `browser_bridge::peer_pid` (attribution) and `browsers://update` (live feed).
**If that import list grows, something is being duplicated.**

---

## Invariants — breaking these is a real bug, not a style issue

Each has a test. If you change behaviour here, change the test deliberately.

1. **Only `HandshakeVerified` can produce `Active`.**
   `activation::tests::only_handshake_can_produce_active`
2. **Activation uses `verified_os_id`, never `effective_os_id` / self-report.**
   Every Chromium fork reports itself as "Chrome" from an MV3 service worker, so
   the self-report would activate Chrome when the user installed into Brave.
   Attribution failure ⇒ activate nothing. See `handler::apply_verified_handshake`.
   `browser_detector::tests::activation_is_keyed_by_verified_os_id_not_self_report`
3. **Only a *running* browser can be revoked.** A closed browser says nothing
   about its extensions. 120 s continuous running-and-silent; timer resets on
   reconnect so sleep/resume never revokes.
   `verify::tests::{closed_browser_is_never_revoked…, sleep_resume_does_not_revoke}`
4. **Activation fires on the `hello` frame, not the first `full`.** A browser
   with no tabs must still connect. `ws.rs` Hello arm. QA case B8.
5. **A repeat handshake returns `false` from `store.apply`.** Heartbeats arrive
   ~1/s; reporting them as changes means a disk write and a UI re-render per second.
6. **The gate renders *over* the dashboard, not instead of it.** Swapping out
   `children` unmounts the app.
7. **Engine table and catalog must agree.** `engine::tests::table_matches_catalog_exactly`
   fails the build if a browser is added to one and not the other.

---

## Deliberate decisions (do not "fix" these)

- **Edge/Opera/OperaGX are `NeedsOptIn`, not `Native`.** Both need a one-time
  opt-in before the store's Add button works. Marking them `Native` produces a
  listing whose button silently does nothing.
- **`engine.rs` is standalone, not fields on `BrowserCatalogEntry`.**
  `browser_catalog` is `#[cfg(windows)]`; merging them would make the module
  Windows-only and untestable. The parity test prevents drift instead.
- **`emit_browsers_to_ui` reads activation from managed state, not a parameter.**
  It has 13 call sites that have no business knowing about activation.
- **`dev_lab/wake.rs::launch_no_focus` and `launcher.rs` both spawn browsers.**
  Accepted for beta. They want opposite things — wake avoids focus, setup must
  bring the browser forward. Revisit after testing; do not merge blindly.
- **Guides are data, not components.** Adding a step = one array entry. A test
  asserts no guide uses a placeholder the interpolator can't resolve.

---

## Known debt

- **Clippy: 17 pre-existing errors** in `app/mod.rs`, `vault/commands.rs`,
  `downloader/{binary,state}.rs`, `browser_audio.rs`,
  `browser_bridge/{command,peer_pid,mod}.rs`, `browser_os_scan.rs`,
  `browser_focus_win.rs`, `inapp_player/{mod,window}.rs`, `window_widget.rs`.
  Mostly mechanical. **Do not add `-D warnings` to CI until cleared.**
- **`#[allow(dead_code)]` on `mod extension_setup`** in `lib.rs` — a few
  accessors are test-only until the dev-lab activation panel lands.
- **`extensionInstalled` is deprecated** but still on the DTO for compatibility.
  New code reads `activationState`. Remove once nothing reads it.
- **No dev-lab activation panel** (force states, clear store, simulate
  revocation). Planned in Phase 5, not built. `store::forget` and
  `extension_setup_reset` exist for it.
- **No component tests** — `vitest.config.ts` only includes `*.test.ts` and
  there's no jsdom/RTL. Logic lives in pure modules so this doesn't matter yet.
  Adding component tests means adding those deps first.

---

## Next steps, in order

1. **Run the QA script.** `EXTENSION_SETUP_QA.md`, sections D → B8 → C → E.
2. **Check `extVersion` on first connect.** If the published extension reports a
   version below `MIN_EXT_VERSION` (`browser_bridge/protocol/version.rs`), the
   socket closes during `hello` and every browser sits at "Waiting for install…"
   forever. Console shows `rejected extVersion`.
3. Dev-lab activation panel (makes QA sections E and G repeatable).
4. Clippy cleanup pass.
5. Decide on the two launch paths after real-world testing.

## Commands

```powershell
cargo test --manifest-path src-tauri\Cargo.toml --lib          # 289
cargo test --manifest-path src-tauri\Cargo.toml --lib extension_setup
npm test                                                        # 161
npx tsc --noEmit
npm run build
```

Reset activation state: delete `%APPDATA%\com.t14.pilpod\browser_activation.json`
