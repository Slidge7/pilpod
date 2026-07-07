# Browser Identity Overhaul — Phased Plan

Goal: make browser detection, browser↔extension binding, multi-profile/multi-window handling, and icons/names rock solid — plus a Dev Lab that covers every state and action for testing.

**Gate rule: no phase starts until the previous phase's tests pass** (`npm test` for TS, `cargo test` in `src-tauri` on Windows for Rust).

---

## Current weaknesses (found in code review)

| Area | Problem | Location |
|---|---|---|
| Icons | Extracted from exe via `SHGetFileInfoW` — fails when exe path resolution fails, inconsistent quality | `browser_icon.rs` |
| Names | OK in catalog, but rows can show extension-reported name when OS info is missing | `browser_detector.rs` merge |
| Ext↔browser link | Extension self-identifies via UA sniffing: Brave/Vivaldi/Arc/Yandex/Chromium all report **"Chrome"**; Opera GX and Opera both `OPR/` | `pilpod-companion/src/background/index.js` `detectBrowser()` |
| Link (desktop side) | `browser_name_to_id(slot.browser_name)` trusts that weak name → wrong row, or two browsers merged into one | `browser_detector.rs`, `browser_catalog.rs` |
| Profiles | Profile label is a UUID prefix (`Profile 3f9a2c1b`) — meaningless to user; no real profile identity | `merge_detected_and_slots` |
| Windows | Tabs carry `window_id` but no per-window model, focus logic uses caption hints only | `browser_focus_win.rs`, `groupTabsByWindow.ts` |
| Dev Lab | Only OS scan + wake-and-sync; no live state inspection, no event log, small screen | `src/features/dev-lab/`, `src-tauri/src/dev_lab/` |

---

## Phase 1 — Bundled icons & names (identity assets)

Stop relying on OS icon extraction. Icons become app assets keyed by catalog id.

**Salah's part:** download PNGs and drop them into `src-tauri/icons/browsers/` using the exact filenames in `src-tauri/icons/browsers/MANIFEST.md`. Review/edit display names in the same manifest (names live in `browser_catalog.rs`).

**Code part (done by Claude):**
- New `browser_icon.rs`: loads `icons/browsers/{id}.png` from the Tauri resource dir at startup into an in-memory cache; serves the same `data:image/png;base64,...` URLs (frontend contract unchanged).
- Fallback chain: `{id}.png` → `_generic.png` → `None`. No `SHGetFileInfoW` code path left — deterministic.
- `tauri.conf.json`: add `icons/browsers/*` to bundle resources.
- `app/setup.rs`: call `browser_icon::init(resource_dir)` once.

**Tests (gate):**
- Rust: icon store resolution — id hit, generic fallback, missing-all → None; cache correctness; every catalog id has a manifest entry. Pure `std::fs` logic, no Windows APIs → runs under plain `cargo test`.
- Manual: rows show bundled icons after Salah adds PNGs; a browser with no PNG shows the generic icon.

---

## Phase 2 — Dev Lab v2 (the test harness)

Built **before** the binding/profile work so every later phase can be verified visually. Large maximized window, three live panels + action console + event log.

**Panels:**
1. **Browsers (OS truth):** every catalog entry — installed?, running?, exe path resolved, PIDs, registry sources that matched. Refresh on 2 s detector tick + manual rescan.
2. **Extension slots:** every slot UUID — reported name, mapped os id, binding method (Phase 3 adds: `pid-verified` / `self-report` / `alias-guess`), WS connected, last heartbeat age, reconnecting flag, persisted `extension_installed`.
3. **Tabs & windows:** per slot, tabs grouped by `window_id`, active/audible/muted/pinned flags, media state, favicon.

**Action console (all existing commands, per-row):** wake & sync, force full sync, focus window, close tab, mute/unmute, simulate WS drop (dev-only command that kills the socket), clear persisted `extension_installed`, clear icon cache.

**Event log:** timestamped stream of `browsers://update` payload diffs, WS connect/disconnect, detector changes. Filterable, copy-as-JSON.

**Backend additions (`dev_lab/`):** `dev_get_full_state` (one struct with all three panels' data), `dev_kill_ws(browser_id)`, `dev_clear_ext_installed(os_id)`, event mirror to dev-lab window.

**Tests (gate):**
- Vitest: state reducers, event-log diffing, tab/window grouping in dev-lab hooks.
- Rust: `dev_get_full_state` assembly from mocked states.
- Manual checklist: every action button works against a real browser.

---

## Phase 3 — Solid extension↔browser binding

Ground truth: **socket peer PID matching.** When the extension connects to the loopback bridge, we know the peer port; `GetExtendedTcpTable` maps port → owning PID → `QueryFullProcessImageNameW` → exe path → catalog match (already have `match_running_process`). This identifies Brave/Vivaldi/Arc/Opera GX correctly with zero guessing.

- `browser_bridge/ws.rs` (and HTTP fallback): on accept, resolve peer PID → `os_browser_id_verified`, store on the slot.
- `BrowserSlot` gains `verified_os_id: Option<String>` + `binding: BindingMethod` (`PidVerified | SelfReport | AliasGuess`).
- `merge_detected_and_slots`: prefer `verified_os_id`; self-report only as fallback. Conflict rule: verified id always wins; if verified contradicts self-report, log + surface in Dev Lab.
- Extension self-report v2 (fallback quality): use `navigator.userAgentData.brands`, `navigator.brave.isBrave()`, Opera GX detection — still secondary to PID.
- Persisted `extension_installed` keyed by **verified** os id; migration for old file.

**Tests (gate):**
- Rust: port→pid→exe→id mapping (mockable table), merge with verified/unverified/conflicting slots, Opera vs Opera GX same-exe disambiguation, Tor vs Firefox, migration of `browser_ext_state.json`.
- Vitest (companion): `detectBrowser()` v2 against UA/brands fixtures for all 13 browsers.
- Manual (via Dev Lab): connect extension in Chrome + Brave + Edge simultaneously → three rows, each `pid-verified`, no cross-talk.

---

## Phase 4 — Multi-profile & multi-window

- **Profile identity:** each extension install (per profile) already has a stable UUID. Add friendly labels: extension sends `chrome.identity.getProfileUserInfo` email (when permitted) or a user-editable label stored in extension storage; desktop falls back to `Profile 1/2/3` with **stable ordering** (first-seen persisted), never UUID prefixes.
- **Window model:** slots report windows (`window_id`, focused, tab count); desktop keeps `Vec<BrowserWindow>` per slot; focus command targets a specific window (by window id via extension command first, caption-hint only as last resort).
- **Detector:** count running PIDs per browser; distinguish "running" vs "N windows / M profiles connected"; handle profile launched with `--profile-directory` (different PID, same exe).
- UI: profile chips under each browser; window groups in tab lists (reuse `groupTabsByWindow`).

**Tests (gate):**
- Rust: stable profile ordering persistence, window list merge, per-window focus dispatch.
- Vitest: window grouping edge cases (moved tab, closed window, focus change).
- Manual (via Dev Lab): 2 Chrome profiles + 2 windows each → 2 rows, 2 window groups per row, focus targets exact window.

---

## Phase 5 — Hardening & regression suite

- Detection state machine audit: installed/running/installed+extension/reconnecting transitions debounced (no flicker on missed heartbeat — extend existing persisted-store approach to `running`).
- Sleep/resume, browser update (exe replaced mid-run), uninstall while connected, extension reinstall (new UUID) → old slot GC.
- Full regression checklist doc + `npm test` + `cargo test` green.
- Dev Lab "scenario" buttons to simulate the above where possible.

---

## Test execution note

Rust tests must run on Salah's Windows machine (`cd src-tauri && cargo test`) — the crate uses Windows-only APIs. TS tests (`npm test`) run anywhere. Each phase ends with both green + a short manual checklist in Dev Lab.
