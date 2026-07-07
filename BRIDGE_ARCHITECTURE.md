# PilPod ⇄ Companion — Bridge Architecture (v2)

> **Purpose.** This is the executable plan for the connection between the
> **PilPod desktop app** (Rust/Tauri, this repo) and the **PilPod Companion**
> browser extension (`./pilpod-companion`). It is written to be read at the
> start of an implementation session and acted on directly.
>
> **Mandate (from product owner):** the existing wire protocol is legacy and
> not worth preserving — design the bridge as a new thing, best-in-class.
> **When trade-offs arise, optimize for latency/throughput.**

---

## 0. Current state (verified June 2026)

**Rust side — bridge is alive and complete** (`src-tauri/src/browser_bridge/`):

- `http.rs` — axum HTTP server on `127.0.0.1:17399`: `POST /browser-tabs`,
  `GET /capabilities`, loopback-checked, CORS `Any`.
- `ws.rs` — tokio-tungstenite WS server on `127.0.0.1:17400/ws` (primary).
- `handler.rs` — shared ingest (`apply_ingest`), DTOs (`BrowserTabPost`,
  `TabMediaPost`), `convert_tab`, command draining.
- `connections.rs` — `WsConnectionMap = Arc<Mutex<HashMap<browserId, mpsc::UnboundedSender<String>>>>`, push helpers.
- `protocol.rs` — `PROTOCOL_VERSION="1"`, `bridge_capabilities()`, version gate.
- `command.rs` — Tauri command `browser_media_control` (stringly-typed actions).
- `system_events.rs` — Win32 power-resume listener → invalidates slots.
- State lives in `Arc<Mutex<…>>` maps: `BrowserSlotsMap`, `BrowserCommandsQueue`,
  detected/ext/reconnecting stores. UI updates via `emit_browsers_to_ui`.

**Companion side — client was deleted.** Commit `47f2b43 "desktop bridge
removed"` stripped `wsTransport.js`, `httpTransport.js`, `bridgeConfig.js`,
`commands/commandHandler.js`, `shared/constants.js`. Backup is in commit
`471dd35`. **Net result today: the Rust server listens, but nothing connects.**
The companion is currently a standalone tab navigator built on its `TabRegistry`
single-source-of-truth (`src/background/tabs/registry.js`).

**Implications for this plan.**
1. We re-introduce the client, but as a clean SOLID transport layer, not a
   restore of the old files.
2. We refactor the Rust side off shared `Mutex` maps toward a message-passing
   session model (kills lock contention and `.lock()` poisoning handling).
3. We replace the v1 wire format (full tab array every change + 4 Hz ping) with
   a delta + subscribed-progress protocol (v2). No backward compatibility.

### Pain points in v1 that v2 must fix (latency/throughput first)

| # | v1 behavior | Cost | v2 fix |
|---|-------------|------|--------|
| 1 | Full `tabs[]` pushed on every change | Bandwidth + JS serialize + Rust `hash_tabs` over all tabs | **Delta sync** by `tabId`; whole-array only on connect/resync |
| 2 | 4 Hz heartbeat ping always | Wakes both ends 4×/s when idle | **Event-driven** + 15 s idle keepalive |
| 3 | Progress for all media tabs | N× high-freq traffic | **Subscribed-tab progress only**, server-negotiated rate |
| 4 | Commands drained on next ingest | Up to `PUSH_INTERVAL` (≤250 ms) control latency | **Push commands immediately** over WS |
| 5 | Stringly-typed actions, untyped frames | Runtime errors, no schema | **Typed tagged enums** both sides |
| 6 | `Arc<Mutex<HashMap>>` everywhere | Lock contention, poison handling | **Session actor** owns state, mpsc |
| 7 | Loopback only, no auth | Any local process can read tabs / inject commands | **Origin allowlist + pairing token** |

---

## 1. Guiding principles

- **Latency/throughput is the tiebreaker.** Hot paths (commands, progress) are
  optimized first; everything else serves them.
- **One source of truth per side.** Companion: `TabRegistry`. Desktop: the
  session store owned by the `SessionManager` actor. Transports never hold
  domain state.
- **SOLID transport.** Orchestrator depends on a `Transport` interface (DIP);
  WebSocket is the only implementation we ship, but the seam stays clean.
- **Typed protocol is the contract.** A single `PROTOCOL.md` + mirrored type
  definitions (TS + Rust serde) are the source of truth. No stringly-typed
  frames or actions.
- **Lossy where it's allowed, reliable where it matters.** Progress frames are
  droppable; commands and state deltas are not.
- **Fail closed, recover fast.** On any desync, resync with a full snapshot;
  reconnect with exponential backoff + jitter.

---

## 2. Topology & transport

```
┌────────────────────────────┐         ws://127.0.0.1:17400/ws        ┌─────────────────────────────┐
│  Companion (MV3 SW)         │  ◄───────────────────────────────►    │  PilPod desktop (Rust/Tauri)│
│                             │     single persistent WebSocket        │                             │
│  TabRegistry (SSoT)         │                                        │  SessionManager actor       │
│     │ dirty events          │   client→app: hello/full/delta/prog    │     │ per-browser Session   │
│  BridgeClient ──────────────┼──  app→client: welcome/cmd/resync/ping─┼──►  SessionStore (merged)   │
│   Transport│Codec│Sync│Cmd  │                                        │   Tauri events → UI         │
└────────────────────────────┘                                        └─────────────────────────────┘
        also feeds the popup UI (same TabRegistry)        optional GET /health (discovery only)
```

**Decision: WebSocket-only for data + commands.** Drop the HTTP `POST
/browser-tabs` push path entirely. Keep one tiny `GET /health` (returns
`{app:"pilpod", bridge:2, ports, minExtVersion}`) purely so the extension can
cheaply detect "is the app running / which port" without holding a socket —
used for UI state and port discovery, never for data.

**Why WS keeps the MV3 service worker alive.** Chrome resets the SW idle timer
on WebSocket activity. A persistent WS with ≥1 frame per <30 s (our 15 s
keepalive, plus any progress during playback) keeps the SW resident while the
bridge is connected. On SW eviction the socket closes; on next wake the client
reconnects and re-HELLOs.

**Port discovery.** Default `17400`. If connect fails, probe a small fixed
range (`17400–17409`) and confirm identity via the `welcome` frame signature.
`/health` on `17399` can advertise the active WS port for zero-guess discovery.

---

## 3. Protocol v2 (the contract)

JSON text frames (human-debuggable; revisit MessagePack for `prog` only if
profiling demands it). Every frame is a serde **internally-tagged enum** on
field `t`. Hot-path frames use short keys.

### 3.1 Client → App

```jsonc
// First frame after socket open. Identifies + negotiates.
{ "t":"hello", "v":2, "browserId":"<uuid>",
  "browser":{ "name":"Chrome", "type":"chrome", "version":"126" },
  "extVersion":"3.0.0", "token":"<pairing-token|null>",
  "caps":{ "delta":true, "progress":true } }

// Complete snapshot. Sent right after hello, and on every resync request.
{ "t":"full", "rev":1, "tabs":[ <TabState>, ... ] }

// Incremental change. rev increments by exactly 1 per client session.
{ "t":"delta", "rev":2, "upsert":[ <TabState>, ... ], "remove":[ <tabId>, ... ] }

// High-frequency, ACTIVE/subscribed tab only. Lossy. Minimal shape.
{ "t":"prog", "id":<tabId>, "ct":<currentTime>, "st":1, "d":<duration?> }
//   st: 0 paused | 1 playing ; d included only when it changes

{ "t":"ack", "id":"<cmdId>", "ok":true, "error":null }   // optional, for cmds needing confirmation
{ "t":"pong", "seq":<n> }
{ "t":"bye" }                                            // best-effort on unload
```

`TabState` (full object on `full`/`delta.upsert`; the companion sends the whole
tab when any field changes — per-field diffing is not worth the JS CPU):

```jsonc
{ "tabId":123, "windowId":1, "url":"…", "title":"…", "favIconUrl":"…",
  "active":true, "windowFocused":true, "audible":true, "muted":false,
  "pinned":false, "index":4,
  "media": {            // null when no media detected
     "playbackState":"playing",   // playing|paused|none
     "title":"…","artist":"…","album":"…","artworkUrl":"…",
     "duration":215.0,"currentTime":12.3,
     "tabVolume":100,"tabMuted":false,
     "canSeek":true,"canPip":true,"canNext":false,"canPrev":false } }
```

### 3.2 App → Client

```jsonc
// Response to hello. Server-driven config (replaces v1 GET /capabilities).
{ "t":"welcome", "v":2, "bridge":"2.0", "sessionId":"…",
  "caps":{ "progressHz":5, "idlePingMs":15000, "deltaDebounceMs":40, "maxTabs":500 } }

// Control. Pushed IMMEDIATELY (no draining). id for optional ack/latency metrics.
{ "t":"cmd", "id":"c-9", "tabId":123, "action":"playPause", "value":null }
{ "t":"cmds", "items":[ { "id":"c-10","tabId":1,"action":"seek","value":42.0 }, … ] }

// Ask the client to (re)send a full snapshot — on rev gap or after app resume.
{ "t":"resync" }

// Subscribe/unsubscribe high-freq progress for one tab (the tab the desktop UI shows).
{ "t":"sub", "tabId":123 }
{ "t":"unsub", "tabId":123 }

{ "t":"ping", "seq":<n> }
```

`action` is a typed enum shared by both sides:
`playPause | next | previous | seek | setTabVolume | muteTab | pip |
focusTab | reactivateTab | reloadTab | closeTab`.

### 3.3 Consistency model

- `rev` is monotonic per client session, starting at the `full` that follows
  `hello`. Server stores `last_rev`. If an incoming `delta.rev != last_rev+1`,
  server replies `resync` and ignores deltas until the next `full`.
- TCP guarantees in-order delivery, so gaps only occur across reconnects — and
  reconnect always begins with `hello` → `full`. This keeps deltas safe while
  cheap.
- Progress frames carry no `rev` and may be dropped freely.

### 3.4 Performance budget (targets to verify)

- Control latency (UI click → content script acts): **< 50 ms** p95.
- Idle uplink traffic: **1 frame / 15 s** per browser.
- Progress frame size: **< 64 bytes**; rate capped by `welcome.progressHz`.
- A single-tab change pushes **one** `delta` with one `upsert`, not the whole list.

---

## 4. Companion (client) — SOLID design

New module tree under `pilpod-companion/src/bridge/` (bundled into the existing
module SW via the current esbuild/`type:module` setup):

```
src/bridge/
  BridgeClient.js          # orchestrator + state machine (DIP hub)
  transport/
    Transport.js           # interface: connect/send/close + on{open,message,close}
    WebSocketTransport.js   # the only impl; backoff+jitter, keepalive
  protocol/
    messages.js            # frame type + ACTION enum constants (SSoT, mirrors Rust)
    Codec.js               # encode()/decode(); validates shapes
  sync/
    SyncEngine.js          # rev, lastSent map, full vs delta, debounce; subs to TabRegistry
    ProgressEmitter.js     # subscribed-tab progress at negotiated Hz (lossy)
  commands/
    CommandRouter.js       # COMMAND → existing control pipeline (OCP: one handler/action)
  identity/
    BrowserIdentity.js     # persistent browserId (chrome.storage.local) + browser type
  config/
    BridgeConfig.js        # defaults + welcome-negotiated overrides
  pairing/
    token.js               # read pairing token from storage (options page)
```

**State machine (`BridgeClient`):**
`OFFLINE → DISCOVERING → CONNECTING → HANDSHAKING → READY → (RESYNC) → … →
BACKOFF → CONNECTING`. Each transition is the only place that touches the
transport, so reconnect logic lives in one spot.

**Responsibilities (SRP):**
- `WebSocketTransport` — bytes in/out + reconnection timing only. No protocol
  knowledge. Backoff: 0.5 s → 1 → 2 → 4 → 8 s cap, ±20% jitter; reset on READY.
- `Codec` — `hello/full/delta/prog/...` ⇄ objects; rejects malformed frames.
- `SyncEngine` — subscribes to `TabRegistry` dirty signal; keeps `lastSent`
  (tabId → serialized TabState); emits `full` on (re)connect/resync, `delta`
  otherwise; debounces at `welcome.deltaDebounceMs` (default 40 ms). Owns `rev`.
- `ProgressEmitter` — only runs for the currently subscribed tabId; reads the
  active media element snapshot at `welcome.progressHz`; drops frames if the
  socket buffer is non-empty (lossy).
- `CommandRouter` — maps each `action` to the **existing** control surface so we
  reuse, not duplicate: `seek`→`SEEK_MEDIA`, `pip`→`PILPOD_PIP_TOGGLE`,
  `setTabVolume`→volume path, `muteTab`→`chrome.tabs.update({muted})`,
  `focusTab`→focus handler, `reload/close`→`chrome.tabs` APIs,
  `playPause/next/previous`→`PILPOD_MEDIA_CONTROL`.
- `BrowserIdentity` — generate+persist a UUID once; detect browser type from UA.
- `BridgeConfig` — immutable defaults, replaced by `welcome.caps` at runtime.

**Integration.** `background.js` constructs one `BridgeClient(registry, …)` and
starts it. The popup keeps working unchanged — both the popup bridge and the
`BridgeClient` are independent **readers** of the same `TabRegistry` (SSoT).
The `TabRegistry` must expose: `all()`, `isDirty()/markDirty()/clearDirty()`
(already present) plus a lightweight change subscription (add an observer
callback so `SyncEngine` doesn't poll).

---

## 5. PilPod desktop (server) — SOLID design

Refactor `src-tauri/src/browser_bridge/` toward message passing:

```
browser_bridge/
  mod.rs           # spawn(): one tokio runtime; start WS server + SessionManager + /health
  transport/
    ws.rs          # accept loop (loopback + Origin check) → spawn Session task
    health.rs      # GET /health only (axum), discovery
  protocol/
    frames.rs      # #[serde(tag="t")] ClientMsg / ServerMsg enums; MediaAction enum
    version.rs     # negotiate(v) → caps
  session/
    manager.rs     # SessionManager actor: owns HashMap<browserId, SessionHandle>; mpsc API
    session.rs     # Session actor: per-connection state (rev, last_seen, sub tabId), owns its socket
    store.rs       # merged view the Tauri UI consumes; apply_full/apply_delta
  command.rs       # Tauri command browser_media_control → SessionManager::send_command (typed)
  system_events.rs # power-resume → SessionManager::broadcast(Resync) + mark stale
```

**Key changes (DIP/SRP + latency):**
- **`SessionManager` actor** replaces `Arc<Mutex<HashMap>>`. A single task owns
  the session map; everything talks to it over an mpsc command channel
  (`Register`, `Drop`, `ApplyFrame`, `SendCommand{browserId,…}`,
  `Broadcast(Resync)`, `Snapshot`). No locks on the hot path, no poison
  handling.
- **`Session` actor per connection** owns: its outbound sink, `last_rev`, the
  currently subscribed tabId, and `last_seen`. Outbound uses a **bounded**
  channel; a separate lossy lane for `prog`/state vs a reliable lane for `cmd`.
  If the bounded lane is full, drop oldest progress (never drop commands).
- **Typed frames** (`frames.rs`) end the stringly-typed `match` in `command.rs`.
- **Commands push immediately** — `browser_media_control` → `SessionManager`
  → `Session` outbound, no queue draining, no TTL polling.
- **Tauri UI updates** are debounced/coalesced in `store.rs` (emit at most every
  ~50 ms) so a burst of deltas doesn't spam the front end.
- **`tracing`** replaces `eprintln!` (structured, levelled).
- **Resume**: power listener tells `SessionManager` to mark all sessions stale
  and broadcast `resync`; clients answer with a fresh `full`.

---

## 6. Security model (origin + pairing)

Loopback binding stays, but loopback is not a trust boundary (any local process
can connect). Layered defenses, cheap-first:

1. **Origin allowlist (zero-config default).** Validate the WS upgrade `Origin`
   header equals a known `chrome-extension://<ID>` / `moz-extension://<ID>` set.
   Reject otherwise. (tokio-tungstenite: inspect headers in the
   `accept_hdr_async` callback.) Web pages can't forge the extension origin.
2. **Pairing token (hardening).** App generates a token on first run, stores it
   in its config dir, and shows it in the PilPod UI. The user pastes it once
   into the extension's options page (`chrome.storage.local`). Every `hello`
   carries it; the server rejects mismatches. Defends against other local apps
   spoofing `Origin`.
3. **Min-version gate** via `/health.minExtVersion` and `hello.extVersion`.

Given the **performance-first** mandate, ship Origin allowlist with the core and
land the pairing token in the hardening phase (Phase 5).

---

## 7. Session-by-session roadmap

Each phase is independently shippable and leaves both apps building.

### Phase 0 — Protocol & shared types
- Write `PROTOCOL.md` (frames from §3 verbatim) at repo root.
- Rust: `protocol/frames.rs` — `ClientMsg`/`ServerMsg` serde enums + `MediaAction`.
- Companion: `protocol/messages.js` — same type strings + `ACTION` enum.
- **Exit:** both type sets compile; a round-trip serialize/deserialize unit test
  on each side passes for every frame.

### Phase 1 — Rust refactor to actors (behavior-preserving)
- Introduce `SessionManager` + `Session` actors; move slot/command/connection
  state into them; keep emitting the same Tauri events.
- WS-only accept loop with loopback + Origin allowlist; add `/health`; delete the
  `POST /browser-tabs` path.
- Swap `eprintln!`→`tracing`.
- **Exit:** desktop builds; with a manual `wscat` HELLO+FULL the UI lists tabs;
  `browser_media_control` delivers a `cmd` frame in < 50 ms (logged).

### Phase 2 — Companion client foundation
- `BridgeClient` + `WebSocketTransport` + `Codec` + `BrowserIdentity` + `BridgeConfig`.
- Connect → `hello` → `welcome`; send `full` on connect; reconnect w/ backoff.
- Wire into `background.js`; add `TabRegistry` change-observer hook.
- **Exit:** launching the desktop app + extension shows the browser's tabs live
  in PilPod; killing the app and reopening auto-reconnects.

### Phase 3 — Delta sync + commands end-to-end
- `SyncEngine`: `lastSent` diff, `delta` frames, `rev`, resync handling.
- `CommandRouter`: all actions mapped to existing control pipeline.
- Rust `store.rs`: `apply_delta` + rev-gap → `resync`.
- **Exit:** a single tab change sends one `delta`; every desktop control
  (play/pause, seek, volume, mute, pip, next/prev, focus, reload, close)
  works on Chrome and Edge.

### Phase 4 — Subscribed progress channel
- `sub`/`unsub` from desktop when the user opens/closes a tab's detail view.
- `ProgressEmitter` streams the subscribed tab at `welcome.progressHz`, lossy.
- Rust lossy outbound lane + coalescing.
- **Exit:** seekbar in PilPod updates smoothly for the viewed tab only; idle
  uplink is 1 frame/15 s; CPU flat with 200+ open tabs.

### Phase 5 — Hardening & metrics
- Pairing token + options page; min-version gate; port discovery via `/health`.
- Bounded-channel backpressure tuning; reconnect storm protection.
- Latency/throughput instrumentation; resume-correctness tests; protocol fuzz.
- **Exit:** documented latency budget met; security review of the local surface
  passes; both test suites green.

---

## 8. Code anchors (so next session moves fast)

**Rust (existing, to reuse/refactor):**
- Ports/paths: `browser_bridge/mod.rs` (`BROWSER_WS_PORT=17400`, `BROWSER_BRIDGE_PORT=17399`).
- DTOs: `browser_dto.rs` (`BrowserTab`, `TabMedia`), `handler.rs` (`convert_tab`).
- State maps: `browser_tabs` (`BrowserSlotsMap`, `BrowserCommandsQueue`, `hash_tabs`, `BrowserMediaCommand`).
- UI emit: `browser_detector::emit_browsers_to_ui`, `emit_on_connection_change`.
- Tauri command: `browser_bridge/command.rs::browser_media_control`.
- Resume: `system_events.rs` (`PBT_APMRESUMEAUTOMATIC`).

**Companion (existing, to build on):**
- SSoT: `src/background/tabs/registry.js` (`TabRegistry`: `all/isDirty/markDirty/clearDirty/applyMediaSnapshot`).
- Tab shape: `src/background/utils/tabSerializer.js::serializeTab`.
- Control surface: handlers `SEEK_MEDIA`, `PIP_TOGGLE`, volume/mute/focus/reload/close
  in `src/background/handlers/*` and content `PILPOD_MEDIA_CONTROL`.
- Old client reference (do NOT restore, mine for ideas): commit `471dd35`
  (`wsTransport.js`, `bridgeConfig.js`, `commands/commandHandler.js`).

**Mirroring rule.** `PROTOCOL.md` is the single source of truth. `frames.rs`
(serde) and `protocol/messages.js` must be changed together in the same commit;
Phase 0 round-trip tests guard drift.
