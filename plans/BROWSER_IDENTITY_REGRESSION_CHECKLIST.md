# Browser Identity — Regression Checklist

Run this after ANY change to browser detection, the bridge, the companion
extension's identity code, or the Dev Lab. Companion plan:
`plans/BROWSER_IDENTITY_OVERHAUL.md`.

## 1. Automated suites (all must be green)

| Suite | Command | Baseline |
|---|---|---|
| Rust | `cd src-tauri && cargo test` | 75+ tests, 0 fail |
| Rust build | `cd src-tauri && cargo check` | zero warnings |
| App TS | `npm test` | 30+ tests |
| App types | `npx tsc --noEmit` | clean |
| App build | `npm run build` | success |
| Companion | `cd pilpod-companion && npm test` | 107+ tests |

## 2. Manual — Dev Lab basics (Phase 2)

Run `npm run tauri dev`, open the Dev Lab (large window, 3 panels).

- [ ] Refresh state → OS browsers panel lists installed/running browsers with icons
- [ ] Event log shows the initial snapshot entry and live diffs on any change
- [ ] Merged-payload footer expands and matches the dashboard's rows

## 3. Manual — icons (Phase 1)

- [ ] Every installed browser shows its bundled PNG (from `src-tauri/icons/browsers/`)
- [ ] A browser with no PNG shows the generic globe, not a broken image
- [ ] Replace a PNG → "Clear icon cache" → new icon appears without restart
- [ ] Console at startup logs `[browser-icon] using <dir> (N png files)` with the expected dir

## 4. Manual — binding (Phase 3)

Extension loaded in at least one browser; more browsers = better coverage.

- [ ] Connected slot shows green **pid-verified** badge
- [ ] Brave/Vivaldi/Opera GX bind to their own rows, never to Chrome's
      (conflict badge `pid-verified ≠ chrome` is CORRECT for Brave)
- [ ] Kill WS → disconnected → reconnecting → connected in the event log; badge returns to pid-verified
- [ ] `node scripts/dev-sim-profiles.mjs` slots show **self-report** binding (socket owner is node.exe — expected)

## 5. Manual — profiles & windows (Phase 4)

Real profiles, or `node scripts/dev-sim-profiles.mjs` while the app runs.

- [ ] Two profiles of one browser → "· Profile 1" / "· Profile 2" labels
- [ ] Restart the app → same numbers on the same profiles (persisted in `browser_profile_order.json`)
- [ ] A third profile joins as "Profile 3" without renumbering 1/2
- [ ] Slot tab tree groups tabs by window, focused window first
- [ ] **Focus** on a window group raises that exact window (real browser) / logs `focusWindow` cmd (simulator)

## 6. Manual — hardening (Phase 5)

- [ ] **Inject stale** on an OS row → dead slot row appears → auto-GC'd within ~2 s (watch the event log) — or press **GC slots**
- [ ] **Simulate resume** → all slots flip to reconnecting; live extensions recover on their own
- [ ] Real sleep/resume: close lid or sleep the machine → wake → rows recover without a stuck "reconnecting"
- [ ] Extension reinstall (remove + re-add in chrome://extensions) → new UUID row appears; old row disappears within 15 min (or GC slots)
- [ ] Browser self-update (or kill + immediately restart the browser exe): the row must NOT flap to "not running" for gaps under ~10 s

## 7. Known intentional behaviours

- Simulator slots always show self-report binding (node.exe is not a catalog browser).
- Slot GC TTL is 15 min (`SLOT_GC_SECS`); running-grace is 10 s (`RUNNING_GRACE_SECS`) — both in `browser_detector.rs`.
- `extension_installed` persists across restarts by design; use "Clear ext flag" to reset.
- Tor self-reports as Firefox; only the PID path (Tor's `firefox.exe` under a `Tor Browser` path) tells them apart.
