# Extension Setup — Manual QA Checklist

> Orientation: [`EXTENSION_SETUP_HANDOFF.md`](./EXTENSION_SETUP_HANDOFF.md).

Companion: **PilPod Companion**, unlisted Chrome Web Store item
`ooogjmdnagfepkocppnldkafbcbmdhal`.
Automated coverage lives in the unit suites; this file covers only what a
machine cannot check for us — real browsers, a real store, and a real user path.

**Reset between runs:** delete `%APPDATA%\com.t14.pilpod\browser_activation.json`
(and `browser_ext_state.json` when testing migration).

---

## A. First run

| # | Step | Expected |
|---|---|---|
| A1 | Delete `browser_activation.json`, launch PilPod | Onboarding gate appears over the dashboard, listing every installed browser |
| A2 | Look at the ordering | Actionable browsers first, then in-progress, connected, skipped, unsupported |
| A3 | Look at a Gecko browser's row (if installed) | "Not supported", no Set-up button, no Skip button |
| A4 | Click **Not now** | Gate closes; dashboard is usable; browser rows are locked |
| A5 | Restart PilPod | Gate does **not** reappear |
| A6 | Menu → the setup entry | Section opens; same list, no "Not now" button |

**A7 — machine with no supported browser.** On a Firefox-only machine the gate
must not appear at all (`nothingToSetUp`). Nothing to offer ⇒ nothing to show.

---

## B. Chrome — the happy path

| # | Step | Expected |
|---|---|---|
| B1 | Chrome row → **Set up** | Guide opens; **Chrome launches** at the listing (not the default browser) |
| B2 | Check the URL bar | No `?authuser=` or `&hl=` — a bare `/detail/<id>` URL |
| B3 | Chrome row state, back in PilPod | "Waiting for install…" with a blinking dot |
| B4 | Click **Add to Chrome** → **Add extension** | — |
| B5 | Return to PilPod **without clicking anything** | Step 3 flips to "Connected" on its own, within a second or two |
| B6 | Wait ~2 s | Guide closes itself; list shows Chrome as **Connected** |
| B7 | Dashboard | Chrome's row is unlocked and shows tabs |

**B8 — the empty-browser case.** Repeat B1–B5 on a Chrome window with only a
blank new tab open. Activation happens on the `hello` frame, so it must still
connect with no tabs to report. *This is the case that would regress if
activation ever moved back to the first `full` frame.*

---

## C. Edge — the opt-in path

| # | Step | Expected |
|---|---|---|
| C1 | Edge row → **Set up** | Guide shows **four** steps, not three |
| C2 | Read step 2 | "Allow extensions from other stores", with its own diagram, **before** the install step |
| C3 | In Edge, ignore the banner and click Add | Nothing happens — this is exactly what step 2 prevents |
| C4 | Accept the banner, then add | Installs |
| C5 | Return to PilPod | Edge flips to Connected; **Chrome's state is unchanged** |

---

## D. Attribution — the one that must not break

The bug this guards against: every Chromium fork self-reports as "Chrome" from
an MV3 service worker, so a naive implementation activates the wrong browser.

| # | Step | Expected |
|---|---|---|
| D1 | With Chrome **not** set up, install the companion in **Brave** | Brave → Connected. **Chrome stays "Not connected".** |
| D2 | Console during D1 | A `binding conflict: extension says "Chrome" … socket owner is brave` line is fine — that is attribution working |
| D3 | Repeat with Vivaldi, and Opera GX if installed | Same: only the browser you installed into activates |
| D4 | Two Chrome profiles, extension in one | Chrome activates (activation is per browser, not per profile) |

**D5 — attribution failure.** If `peer-PID lookup failed` ever appears in the
log, the browser must stay locked rather than activating on the self-report.
Fail closed.

---

## E. Revocation and recovery

| # | Step | Expected |
|---|---|---|
| E1 | Remove the companion from a Connected Chrome, keep Chrome open | After ~2 min: "Disconnected", row re-locks, dashboard shows "Reconnect" |
| E2 | **Close** a Connected browser entirely, wait 5 min | Stays **Connected** — a closed browser tells us nothing about its extensions |
| E3 | Sleep the machine 30+ min, resume | Browsers stay Connected; no revocation, no re-prompt |
| E4 | Reinstall after E1 | Returns to Connected; "connected since" date is the **original** one |
| E5 | Disable (not remove) the extension, keep browser open | Revokes like E1; the row's hint mentions checking it is enabled |

---

## F. Diagnosis hints

| # | Setup | Expected hint |
|---|---|---|
| F1 | Extension installed but bridge port blocked by firewall | "installed here but isn't reaching PilPod… check it's enabled… firewall" |
| F2 | Extension installed, browser closed | "Open the browser and it should connect on its own" |
| F3 | Never installed | No hint (that's the normal pre-setup state, not an error) |

---

## G. Migration and persistence

| # | Step | Expected |
|---|---|---|
| G1 | Seed `browser_ext_state.json` = `{"chrome":true,"brave":false}`, delete `browser_activation.json`, launch | Chrome comes up **Connected**, Brave "Not connected"; no gate (something already works) |
| G2 | Check the app data folder | `browser_activation.json` now exists — migration is frozen, not re-run |
| G3 | Edit the legacy file afterwards, relaunch | Ignored |
| G4 | Corrupt `browser_activation.json`, launch | App starts clean; a `.bak-<ts>` copy is preserved beside it |

---

## H. Packaged build

Everything above is dev-mode. These only fail in a packaged build:

| # | Step | Expected |
|---|---|---|
| H1 | `npm run tauri build`, install the output | — |
| H2 | Run B1 from the installed app | Browser still launches at the listing (exe resolution works outside the dev tree) |
| H3 | Full Chrome walkthrough in the packaged app | Connects |

---

## I. Regression sweep

| # | Area | Expected |
|---|---|---|
| I1 | Tab list, media controls, volume on a Connected browser | Unchanged |
| I2 | Downloader, Vault, playlist player | Unchanged |
| I3 | In-app player row | Never locked, never appears in the setup list |
| I4 | Dock bar while the setup section is open | No dock button reads as active; clicking one leaves setup |
| I5 | Search/filter with a locked browser present | No crash; locked rows show their message rather than tabs |
| I6 | Dev Lab | Opens; `dev_get_full_state` still returns the merged payload |

---

## Automated gates

```powershell
cargo test --manifest-path src-tauri\Cargo.toml --lib
npm test
npx tsc --noEmit
npm run build
```

### Clippy — known pre-existing debt

`cargo clippy -- -D warnings` does **not** pass on this repo and did not before
this module. At the time of writing there were 25 errors across 14 files, none
in `extension_setup`. The files this module touched have been cleaned
(`browser_detector.rs`, `browser_bridge/ws.rs`, `inapp_player/state.rs`), so the
count is now ~17, all in untouched files:

`app/mod.rs` · `vault/commands.rs` · `downloader/{binary,state}.rs` ·
`browser_audio.rs` · `browser_bridge/{command,peer_pid,mod}.rs` ·
`browser_os_scan.rs` · `browser_focus_win.rs` ·
`inapp_player/{mod,window}.rs` · `window_widget.rs`

Most are mechanical (`needless_return`, `manual_div_ceil`, `collapsible_if`,
`clone_on_copy`). A few need a judgement call rather than a rewrite:
`too_many_arguments` on three Tauri commands, `type_complexity` on the peer-PID
cache, `result_large_err` in the bridge. Worth a dedicated cleanup pass; adding
`-D warnings` to CI before that lands would fail every build.

## Sign-off

- [ ] A · first run and dismissal
- [ ] B · Chrome, including the empty-browser case (B8)
- [ ] C · Edge opt-in
- [ ] D · attribution — no cross-activation
- [ ] E · revocation, sleep/resume
- [ ] F · diagnosis hints
- [ ] G · migration
- [ ] H · packaged build
- [ ] I · regression sweep
- [ ] All automated gates green
