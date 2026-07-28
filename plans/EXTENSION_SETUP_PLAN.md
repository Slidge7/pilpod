# PilPod — Extension Setup & Onboarding Module (v3, Web Store)

> **Picking this work up in a new session? Read
> [`EXTENSION_SETUP_HANDOFF.md`](./EXTENSION_SETUP_HANDOFF.md) first** — status,
> file map, invariants and next steps in one page. This file is the design
> rationale; you rarely need all of it.

> **Supersedes** `plans/EXTENSION_ONBOARDING_PLAN.md` (v2).
> v2 assumed the companion could only be side-loaded as an **unpacked** extension via
> Developer Mode. That is no longer true: the companion is published to the
> **Chrome Web Store as an unlisted item**, so install is a normal one-click
> `Add to Chrome` from a URL. Everything in v2 about `pilpod-companion` path
> resolution, `reveal_companion_folder`, resource bundling, and Developer Mode is
> **dropped**. The activation state machine, peer-PID attribution and gating survive.

**Extension ID:** `ooogjmdnagfepkocppnldkafbcbmdhal`
**Listing:** `https://chromewebstore.google.com/detail/ooogjmdnagfepkocppnldkafbcbmdhal`

---

## 1. Product flow

```
install PilPod  →  first launch
      │
      ├─ OS scan finds installed browsers            (exists: browser_os_scan.rs)
      │
      ├─ Onboarding gate lists them, each Inactive   (new)
      │     "Chrome  · Not connected  [Set up]"
      │     "Edge    · Not connected  [Set up]"
      │
      ├─ user picks a browser → Setup Guide          (new)
      │     Step 1  Open the listing   → launches THAT browser's exe at the store URL
      │     Step 2  Click "Add to <Browser>"  (+ Edge-only pre-step)
      │     Step 3  Verify — live, auto-advances when the bridge handshake lands
      │
      └─ browser flips Active; dashboard unlocks that row
```

After onboarding the same UI lives permanently at **Menu → Browser Setup**, so the
user can add a second browser, re-check a disconnected one, or read the
instructions again. **Onboarding and the section are the same component** rendered
in two shells — one source of truth, no duplicated copy.

### Decisions locked

| Question | Decision |
|---|---|
| Guide authoring | Typed TS content model (`guides/*.ts`) rendered by one React component |
| Browser scope | Chromium family only; Gecko rows show "not supported yet" |
| Gate policy | Soft — skippable, non-active browsers render as locked dashboard rows |
| Instruction assets | Inline SVG diagrams (no screenshots — they rot on every browser update) |

---

## 2. Module boundaries

Self-contained on both sides of the IPC line. Nothing outside these two folders
gains knowledge of activation beyond one DTO field and one menu entry.

```
src-tauri/src/extension_setup/
  mod.rs          re-exports, module docs
  config.rs       EXTENSION_ID, store URL builders                    [pure]
  activation.rs   ActivationState + advance(state, event)             [pure]
  store.rs        ActivationStore — persistence + legacy migration
  engine.rs       EngineFamily, StoreSupport, per-browser routing     [pure]
  launcher.rs     BrowserLauncher trait + Windows impl + MockLauncher
  commands.rs     #[tauri::command] surface
  tests/          unit tests per module

src/features/extension-setup/
  index.ts                     public surface (2–3 exports, nothing else)
  types.ts                     mirrors the Rust DTO
  guides/
    types.ts                   Guide, GuideStep, StepAction
    chromium.ts                default Chromium walkthrough
    edge.ts                    override: "Allow extensions from other stores"
    unsupported.ts             Gecko / unknown fallback
    index.ts                   guideFor(engine, osBrowserId) resolver   [pure]
  hooks/useExtensionSetup.ts   commands + live browsers://update
  components/
    BrowserSetupCard.tsx       one row: icon, name, state badge, action
    SetupGuide.tsx             renders a Guide; step 3 is live
    SetupStep.tsx              one step + its action button
    StatusBadge.tsx
    diagrams/*.tsx             inline SVG per step
  ExtensionSetupPanel.tsx      the permanent section shell
  OnboardingGate.tsx           first-run shell around the same panel
  __tests__/
```

**Why this scales:** adding a browser = one catalog row + (optionally) one guide
override file. Adding a *step* = one entry in a typed array. Neither touches
React components, Rust commands, or the state machine.

---

## 3. What already exists (reused, not rebuilt)

| Piece | Where | Status |
|---|---|---|
| OS browser scan (registry + process enum) | `browser_os_scan.rs`, `browser_catalog.rs` | ✅ 13 browsers |
| Browser exe path resolution | `browser_catalog.rs` `install_path_reg` | ✅ needed to launch the right browser |
| Peer-PID → browser attribution | `browser_bridge/peer_pid.rs` | ✅ **this is the verification primitive** |
| Persisted "extension installed" bool | `ExtensionInstalledStore` → `browser_ext_state.json` | ✅ superseded by `ActivationStore`, with migration |
| Bridge (HTTP :17399 / WS :17400) | `browser_bridge/` | ✅ |
| Live browser feed to UI | `browsers://update`, `useBrowsers.ts` | ✅ drives step 3 |
| Browser icons | `browser_icon.rs` | ✅ |

**Gaps this module closes:** typed activation state (vs. one bool), store-URL
routing per browser, guide content, onboarding + permanent section UI, dashboard
gating.

---

## Phase 1 — Activation core & config (Rust, pure)

**Objective:** a typed, persisted, testable activation state per browser. No UI, no IPC.

1. `config.rs` — `EXTENSION_ID`, `store_listing_url()`, `store_listing_url_for(engine)`.
   Single constant; changing the published extension is a one-line edit.
2. `activation.rs`:
   ```rust
   pub enum ActivationState { Inactive, SetupPending, Active, Revoked, Skipped }
   pub enum ActivationEvent {
       SetupStarted, HandshakeVerified, ExtensionLost { grace_expired: bool },
       SetupCancelled, Skipped, Reset,
   }
   pub fn advance(state: ActivationState, event: ActivationEvent) -> ActivationState;
   ```
   Pure, total, no I/O. Illegal transitions are no-ops (never panic).
3. `store.rs` — `ActivationStore`: `os_browser_id → { state, first_activated_at, last_verified_at }`
   at `{app_data}/browser_activation.json`. Atomic write (temp + rename). One-time
   migration: `browser_ext_state.json` entries with `true` → `Active`.

**✅ Gate:** full transition-table test; illegal transitions no-op; store round-trip;
legacy migration; missing/corrupt file → empty store, no panic. `cargo test` green.

---

## Phase 2 — Engine routing & command surface (Rust)

**Objective:** the app can open the store listing *in a specific browser* and report
setup status to the UI.

1. `engine.rs` — `EngineFamily { Chromium, Gecko, Other }`, `StoreSupport { Native, NeedsOptIn, Unsupported }`
   (Edge = `NeedsOptIn`), `extensions_page: Option<&str>` for troubleshooting.
   Derived from `browser_catalog.rs` by id — catalog stays the single source of truth.
2. `launcher.rs` — `trait BrowserLauncher { fn open_url(&self, exe: &Path, url: &str) -> Result<()> }`.
   Windows impl spawns the browser exe with the URL as an argument (never
   `ShellExecute` — that would hit the *default* browser, not the chosen one).
   `MockLauncher` records calls for tests.
3. `commands.rs`:
   - `extension_setup_overview()` → `Vec<BrowserSetupInfo>` (id, display name, icon,
     engine, store support, activation state, running, extensions page availability)
   - `open_store_listing(os_browser_id)` → launch + `advance(SetupStarted)`
   - `open_extensions_page(os_browser_id)` → troubleshooting deep link
   - `skip_browser_setup(id)` / `reset_browser_activation(id)` (dev-lab)
   - `extension_setup_dismissed()` / `dismiss_extension_setup()` — first-run flag,
     persisted server-side (**not** localStorage)

**✅ Gate:** every Chromium catalog entry resolves an extensions page; Edge maps to
`NeedsOptIn`; mock launcher asserts correct exe + URL and `SetupPending` transition;
unknown id → typed error with state untouched. `cargo test` green.

---

## Phase 3 — Verified handshake (bridge)

**Objective:** the moment the extension talks to the bridge, exactly the right browser
flips to `Active` — this is what makes step 3 automatic.

1. On WS connect / first POST, `peer_pid::verified_os_id_for_peer` resolves the browser;
   `advance(HandshakeVerified)` → `Active`, persist, emit `browsers://update` immediately.
2. Attribution failure → **fail closed**: log with context, never activate a guess.
3. Revocation sweep in the detector loop: `Active` with no slot/heartbeat past
   `SLOT_GC_SECS`, outside the reconnect grace window → `Revoked`.
4. `DetectedBrowser` gains `activation_state` (camelCase). `extension_installed` /
   `extension_connected` kept for compatibility — no consumer breaks.

**✅ Gate:** attribution unit tests incl. ambiguous exes (`browser.exe`, Tor's
`firefox.exe`); simulated handshake flips exactly one browser; fake-clock revocation
honours the grace window (sleep/resume must not revoke). `cargo test` green.

---

## Phase 4 — React module & guide content

**Objective:** the guide, driven by data, verified live.

1. `guides/types.ts`:
   ```ts
   type StepAction =
     | { kind: 'openStore' } | { kind: 'openExtensionsPage' }
     | { kind: 'copyUrl' }   | { kind: 'none' };
   type GuideStep = { id: string; title: string; body: string;
                      action: StepAction; diagram?: DiagramId; live?: boolean };
   type Guide = { id: string; steps: GuideStep[] };
   ```
   `{browser}` placeholders interpolated at render — one copy string per step, all browsers.
2. `guideFor(engine, osBrowserId)` — pure resolver, override by id then by engine,
   `unsupported` fallback. Exhaustively tested.
3. `useExtensionSetup()` — overview + live `browsers://update`, exposes
   `browsers`, `activate(id)`, `skip(id)`, `openExtensionsPage(id)`.
4. `SetupGuide.tsx` — renders steps; the `live` step subscribes to activation state
   and auto-advances to success exactly once; ~60 s timeout hint with a
   troubleshooting link.

**✅ Gate:** guide resolution matrix (`chrome`→chromium, `msedge`→edge override,
`firefox`→unsupported, unknown→unsupported); auto-advance fires once, not per tick;
action buttons invoke the right command with the right id (mocked `invoke`);
placeholder interpolation. `npm test` + `tsc` clean.

---

## Phase 5 — Gate, section, continuous enforcement

1. `OnboardingGate.tsx` — first run only, when ≥1 detected browser is not `Active`
   and setup isn't dismissed. Soft: "Skip for now" always available.
2. **Permanent section** — SlideMenu entry → `ExtensionSetupPanel`, same panel the
   gate wraps. Always reachable.
3. **Dashboard gating** — non-`Active` browsers render as locked rows
   ("Setup required" + Activate); no tab/media rows for them.
4. Browser installed *after* onboarding → appears `Inactive`, locked, one non-modal
   prompt (once — not per update tick). `Revoked` re-prompts with
   "Extension disconnected — reconnect".
5. Multi-profile: activation is per `os_browser_id`; any verified profile activates
   the browser. Documented, tested.
6. Dev-lab panel: force states, clear store, simulate revocation.

**✅ Gate:** gate visibility matrix (all-active / some-inactive / dismissed / skipped);
locked-row rendering; new-browser prompt fires once; detector-loop test for a browser
appearing mid-run. `npm test` + `cargo test` green.

---

## Phase 6 — E2E & regression

1. `plans/EXTENSION_SETUP_QA.md` manual checklist: fresh install; "Open listing"
   lands in the *correct* browser; Chrome full walkthrough; Edge walkthrough incl.
   the opt-in banner; second browser stays locked; remove extension → `Revoked`
   after GC; legacy migration; packaged build (URL launch works outside dev).
2. Update `plans/BROWSER_IDENTITY_REGRESSION_CHECKLIST.md` with activation cases.
3. Full suite: `cargo test`, `cargo clippy -- -D warnings`, `npm test`, `npm run build`.

**Exit criteria:** detect ✅ · guided store install ✅ · auto-verify ✅ · per-browser
routing ✅ · permanent section ✅ · locked-until-active ✅ · zero regressions.

---

## Build log — decisions that changed during implementation

Recorded because each one is load-bearing and non-obvious from the code alone.

1. **Engine table is standalone, not fields on `BrowserCatalogEntry`** (Phase 2).
   `browser_catalog` is `#[cfg(windows)]`; putting engine data there would make
   the whole module Windows-only and untestable in isolation. Drift is prevented
   by `engine::tests::table_matches_catalog_exactly`, which diffs the two id sets
   in both directions.
2. **Edge, Opera and Opera GX are `NeedsOptIn`, not `Native`** (Phase 2). Both
   need a one-time opt-in before the store's Add button does anything. Shipping
   them as `Native` would produce a listing whose install button silently fails —
   the worst onboarding failure, because it looks like it worked.
3. **`SetupPending` is recorded only after a successful spawn** (Phase 2). A
   browser that never opened must not read as "setting up…".
4. **Activation keys off `verified_os_id`, never `effective_os_id`** (Phase 3).
   Every Chromium fork self-reports as "Chrome" from an MV3 service worker, so
   the self-report would activate Chrome when the user installed into Brave.
   Attribution failure ⇒ no activation. Fail closed.
5. **Revocation requires the browser to be *running*** (Phase 3). A closed
   browser tells us nothing about its extensions. 120 s of continuous
   running-and-silent, timer reset on reconnect, so sleep/resume never revokes.
6. **`emit_browsers_to_ui` reads activation from managed state, not a
   parameter** (Phase 3). It has thirteen call sites across the bridge, dev-lab
   and audio paths, none of which should know about activation. Only
   `build_browsers_payload` (3 call sites) took a new argument, so the merge
   function could stay pure and testable.
7. **Activation fires on the `hello` frame, not the first `full`** (Phase 6
   prep). `hello` is the earliest moment the browser is known, and it means a
   browser with no tabs to report still connects. Covered by QA case B8.
8. **The gate renders *over* the dashboard, not instead of it** (Phase 5).
   Swapping out `children` would unmount the app, so dismissing would remount a
   cold one and the list behind the gate would stop updating.
9. **Dashboard gating reuses the existing `no-ext` status path** (Phase 5)
   rather than adding parallel locked-row UI — `resolveBrowserStatus` now keys
   off `isBrowserLocked(activationState)`.

### Incidental fixes

Two pre-existing type duplications surfaced when `activationState` was added and
were consolidated rather than patched:

- `groupSearchMatchesByBrowser` re-declared `DetectedBrowser`'s shape three
  times (param, return, literal) and silently dropped any new field.
- `ViewType` was declared privately in `BrowserDockBar` and re-declared inline
  in `MediaDashboard`.

Both now share one exported type. Worth grepping for further structural copies.

---

## Risks

| Risk | Mitigation |
|---|---|
| Unlisted listings can 404 for signed-out / wrong-profile users | Guide step: "sign in to the browser profile you want the extension on"; troubleshooting panel with copyable URL |
| Edge blocks other-store extensions by default | `NeedsOptIn` pre-step with its own diagram; detected from the catalog, not hardcoded in the UI |
| Launching a browser exe with a URL may open in an existing window of a *different* profile | Accepted — verification is per browser, not per profile; step 3 confirms reality |
| Store review pulls the item | `config.rs` single constant + `Unsupported` fallback copy |
