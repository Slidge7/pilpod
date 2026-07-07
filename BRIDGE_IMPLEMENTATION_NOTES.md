# Bridge v2 — Implementation Notes

Status of the work executed against `BRIDGE_ARCHITECTURE.md`. Read alongside
`PROTOCOL.md` (the contract).

## What shipped

**Protocol contract (Phase 0)**
- `PROTOCOL.md` — the single source of truth for protocol v2.
- Rust mirror: `src-tauri/src/browser_bridge/protocol/frames.rs`
  (`ClientMsg` / `ServerMsg` / `TabState` / `MediaAction` serde enums) and
  `protocol/version.rs` (negotiation + caps). Round-trip unit tests included.
- JS mirror: `pilpod-companion/src/bridge/protocol/messages.js`
  (frame tags, `Action` enum, encode/decode + validation, and the
  `toTabState`/`toTabMediaState` wire projections), with round-trip + validation
  tests in `messages.test.js`.

**Companion client** — the actual shipped layout under
`pilpod-companion/src/bridge/` is intentionally flat: three files, not the
per-concern folder tree (`transport/`, `sync/SyncEngine.js`,
`commands/CommandRouter.js`, etc.) an earlier draft of this doc described. Those
files were never landed; do not look for them.
- `client.js` — `createBridgeClient()`: the WebSocket transport + reader and the
  only place that drives the connection. Owns the socket lifecycle (open →
  `hello` → `welcome` → ready), reconnect backoff (0.5→30 s with jitter), the
  inbound-liveness watchdog, the desktop's `prog` subscription set, and command
  dispatch (`cmd`/`cmds` → `onCommand`, `ack` per command, `pong` on `ping`).
  Pure transport — no domain state.
- `sync.js` — `createSyncState()` + `buildFull`/`buildDelta`: the rev counter and
  the last-sent diff that decides full-vs-delta payloads.
- `protocol/messages.js` — the wire contract mirror (see above).
- Wiring: `background/index.js` constructs one client via `createBridgeClient`,
  passing `getFullState`/`onCommand`/`onStatus`; the popup is untouched. Desktop
  commands land on `routeBridgeCommand` → the shared `handleAction` path (the
  same one the popup uses) via the `BRIDGE_ACTION_MAP` action table. The tab
  sensors live in `content/main-world-hooks.js` and advertise per-tab
  capabilities (`canSeek`/`canPip`/`canNext`/`canPrev`).

**Desktop server (Phases 1 + 5, pragmatic)**
- `ws.rs` rewritten to speak v2: `hello`→`welcome`, `full`/`delta` (rev-gap →
  `resync`), lossy `prog` (throttled UI emit), `pong` keepalive, `bye`.
- `security.rs` — Origin allowlist (rejects web-page origins; extension origins
  allowed, pinnable), optional pairing token, action-string → `MediaAction`.
- `connections.rs` — commands now push immediate v2 `cmd` frames; global sync is
  a v2 `resync` broadcast.
- `http.rs` — added `GET /health` discovery (`{app,bridge,wsPort,minExtVersion}`).

## Correctness fixes (this pass)

Four gaps found by an end-to-end contract audit and closed:
1. **Media capability flags now reach the desktop.** `canSeek`/`canPip`/`canNext`/
   `canPrev` were parsed in `frames.rs::TabMediaState` but dropped in
   `ws.rs::convert_tab_state` and absent from the internal `TabMedia` DTO. They are
   now threaded through `browser_dto::TabMedia`, both `convert_tab_state` (WS) and
   `handler::convert_tab` (HTTP fallback + `TabMediaPost`), and folded into
   `hash_tabs`/`hash_media` so a capability change triggers a UI diff. The desktop
   `MediaItemCard` gates prev/next/pip/seek on these flags — so dead transport
   buttons (e.g. next/prev on a generic `<video>` that can't skip tracks) no longer
   render.
2. **Server keepalive.** `ws.rs` now emits `ServerMsg::Ping` on the advertised
   `welcome.caps.idlePingMs` cadence, so a medialess/idle connection keeps feeding
   the extension's inbound watchdog instead of being reconnect-churned every ~37 s.
3. **Min-version gate enforced.** The `Hello` handler now calls
   `version::version_at_least(ext_version, MIN_EXT_VERSION)` and rejects an ext that
   reports a too-old version (fail-open only when the version is absent).
4. **PiP from the desktop is a browser constraint, not a bug.** `requestPictureInPicture()`
   requires in-browser transient user activation, which a WebSocket-originated
   command cannot supply; the popup works because a real click propagates
   activation. Left as-is per product decision.

## Verified here

- **Companion: 93/93 vitest tests pass** (added capability-flag coverage in
  `messages.test.js`). Covers Codec round-trip + validation, `sync.js`
  full/delta/rev, and the existing background/UI suites.
- Rust changes verified by reading/symbol audit only (no toolchain here — see
  below).

## NOT compiled here — build on Windows

This sandbox is Linux with no Rust toolchain, and the bridge is
`#[cfg(windows)]` (Tauri + `windows` crates). The Rust changes are written to be
correct and build-safe but **must be compiled on your machine**:

```
cd src-tauri && cargo test -p pilpod browser_bridge   # runs frames/version/security tests
cargo build
```

The Rust changes were kept **additive over the existing state plumbing**
(`BrowserSlotsMap`, `WsConnectionMap`, `apply_ingest`) precisely so that
`browser_detector`, `browser_commands`, `browser_audio`, `browser_tabs`, and
`dev_lab` keep compiling unchanged — verified by symbol audit, not by `cargo`.

## State model — Hybrid (SessionManager actor + consolidated lock)

Chosen over a pure message-passing actor because the Tauri command handlers read
bridge state **synchronously**; routing every read through an mpsc/oneshot
round-trip would add latency to the UI command path and is the largest, riskiest
diff to land without a compiler. The Hybrid keeps synchronous lock reads (fast)
while giving single-owner semantics and atomic multi-map updates.

### Done: the `SessionManager` registry (drop-in, safe)

`connections.rs` no longer exposes a bare `Arc<Mutex<HashMap<String, Sender>>>`.
It now defines a `SessionManager` that owns one `Connection` per profile and is
the sole authority for register / lookup / push / broadcast. Crucially this is a
**drop-in**: `WsConnectionMap` is still `Arc<SessionManager>` (an `Arc<..>`, so
every `Arc::clone` / `tauri::State` / `.manage()` site compiles verbatim) and all
six free functions (`register_ws_connection`, `push_ws_command`, …) keep their
exact signatures and delegate to methods. Zero call-site churn; the per-socket
reader/writer task in `ws.rs` remains the connection's actor.

### Remaining: consolidate the five shared maps behind one `BridgeState` lock

This is the half that **cannot** be a drop-in and must be landed
compiler-in-the-loop (each step green) to honour "each phase leaves both apps
building." It fixes the two real consistency gaps: (a) `apply_ingest` writes
`slots` + `ext_store` + `reconnecting` under three separate locks (non-atomic),
and (b) `emit_browsers_to_ui` reads four maps under four separate locks (torn UI
snapshot), plus the one nested lock-order in `invalidate_slots_on_resume`.

Ordered migration (do with `cargo` after each step):
1. Add `src-tauri/src/browser_bridge/state.rs` defining
   `struct BridgeStateInner { slots, commands, detected, ext_installed,
   reconnecting }` and `pub type BridgeState = Arc<Mutex<BridgeStateInner>>`,
   with typed accessors for the *combined* operations that need atomicity:
   `ingest(...)`, `snapshot_for_ui(...)`, `invalidate_on_resume()`,
   `drain_commands(id)`, `enqueue_command(...)`. `ws_connections` stays separate
   (it is the `SessionManager`, already consolidated).
2. In `app/setup.rs`, build one `BridgeState` and `.manage()` it; keep the old
   individual `.manage()` lines temporarily so nothing breaks.
3. Migrate consumers one at a time (`handler.rs::apply_ingest`,
   `browser_detector` emit fns, `browser_commands`, `browser_audio`,
   `dev_lab`, `command.rs`): swap their 4–5 separate `State<'_, X>` params for a
   single `State<'_, BridgeState>` and call accessors. `cargo build` after each.
4. When no consumer references the old aliases, delete the individual
   `.manage()` lines and the `BrowserSlotsMap` / `BrowserCommandsQueue` /
   `DetectedBrowsersState` / `ExtensionInstalledState` / `ReconnectingBrowsersState`
   type aliases.

Attempting steps 1–4 as one blind edit across the ~10 command signatures is the
one thing that reliably breaks the build, so it is intentionally staged.

## Extension connect UX + the `pilpod://` launch scheme

The options page (`src/ui/options.html` + `options.js`) is now a single
**Connect to PilPod desktop** button instead of a host/port/token form (the raw
fields live under a collapsed "Advanced" section for non-default setups). The
popup header gained a gear button (`#pp-options`) that opens this page via
`chrome.runtime.openOptionsPage()`.

Connect flow (extension side, done):
1. Enable the bridge with defaults and persist config (the background SW's
   `storage.onChanged` handler reconnects the WebSocket).
2. Probe `http://127.0.0.1:17399/health` (`bridgeConfig.probeDesktop`). If the
   app answers (`{ app:"pilpod", … }`) → **Connected**.
3. If not, fire the custom `pilpod://connect` scheme (hidden iframe + a visible
   fallback link) to launch the app, then poll `/health` for ~6 s.
4. Still nothing → show a "PilPod desktop not found — install/open it" hint.

**Desktop dependency (build on Windows).** Step 3 only works once the desktop app
registers the `pilpod://` URL scheme with the OS. That is the one missing piece:
- Add `tauri-plugin-deep-link` (register scheme `pilpod`) and
  `tauri-plugin-single-instance` (so a launch focuses the running window instead
  of spawning a duplicate) in `src-tauri`. Declare the scheme in
  `tauri.conf.json` (`plugins.deep-link.desktop.schemes = ["pilpod"]`) and, for
  installed builds, the Windows registry entry the installer writes.
- Handler behaviour can be minimal: the WS/HTTP servers already start on app
  launch, so on a `pilpod://connect` event just ensure the window is shown/
  focused — the extension reconnects on its own once the app is up.
- Until this ships, everything else still works: if the user launches PilPod
  themselves, Connect finds it via `/health` immediately. The scheme only
  automates the "app isn't running yet" case. The launch URL constant lives in
  `bridgeConfig.DESKTOP_LAUNCH_URL` — keep it in sync with the registered scheme.

## To finish hardening (your machine)

1. Pin your published extension IDs in `security.rs::ALLOWED_EXTENSION_ORIGINS`.
2. Call `browser_bridge::set_pairing_token(Some(token))` during `app/setup.rs`
   once you surface the token in the UI + options page.
3. Build the companion (`npm run build`) and load it; launch the desktop app and
   confirm tabs appear live, controls work, and the seekbar updates for the
   viewed tab only.
