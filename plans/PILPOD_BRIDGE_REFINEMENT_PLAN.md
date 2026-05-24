# PilPod Browser Bridge — Refinement Plan

> **Author:** Senior Engineer Review  
> **Scope:** `pilpod-companion` extension ↔ Tauri desktop bridge  
> **Goals:** (1) Live smooth bidirectional sync, minimal perceived latency. (2) Eliminate redundant work on hot paths. (3) Maintainable, scalable design across N browser profiles.

---

## Executive Summary

The current design works but burns CPU and bandwidth through three core problems:

1. **Full payload pushed every 250ms regardless of whether anything changed** — the extension already diffs state in `registry.js` but never uses that signal to suppress pushes.
2. **Rust emits a Tauri event on every single HTTP POST** — no diff check, triggering a full React re-render 4×/sec per browser even on idle sessions.
3. **`emit_fast_to_ui` (GSMTC) blocks the `tiny_http` single-threaded handler** — a media state callback is on the POST hot path.

The plan below fixes these in two phases:

- **Phase 1 (Quick wins, ~1–2 days):** Zero-risk changes that eliminate ~80% of wasted work without touching the transport architecture.
- **Phase 2 (Architecture, ~1 week):** Split ping/sync protocol, WebSocket upgrade, connection lifecycle hardening, multi-browser scalability.

A third optional phase covers long-term maintainability (protocol versioning, test coverage, doc hygiene).

---

## Target Architecture

### Keep or Replace HTTP polling?

**Recommendation: Migrate to WebSocket in Phase 2, keep HTTP polling as fallback.**

Rationale:

| Criterion | HTTP Polling (current) | WebSocket |
|---|---|---|
| Command latency | Up to 250ms (next heartbeat) | <10ms (server push) |
| Overhead per idle second | ~4 POSTs × JSON parse × emit | 1 keepalive frame |
| MV3 service worker compatibility | ✅ Works today | ✅ Works (persistent WS in SW) |
| Multi-browser (N profiles) | N×4 req/s | N×1 connection |
| Implementation complexity | Low | Medium |
| Fallback if WS unavailable | Already exists | Needs polling fallback |

WebSocket is the right long-term answer for command latency (<100ms goal) and for N-browser scalability. But Phase 1 fixes the immediate waste without requiring it.

### Protocol Split (applies to both HTTP and WS)

Introduce two message types:

```
PING   — lightweight heartbeat; no tab payload; just { browserId, seq }
SYNC   — full or delta tab state; only sent when state actually changed
```

This decouples "are you alive?" from "here is state" — the primary source of wasted work today.

---

## Phase 1 — Quick Wins (No Architecture Change)

All changes are backward-compatible. None break the 250ms/3s timing contract.

---

### P1-1 · Extension: Suppress heartbeat payload when state is unchanged

**File:** `pilpod-companion/src/background/transport/transport.js`  
**Effort:** 30 min  
**Impact:** Eliminates full JSON serialization + network + Rust parse on ~90% of heartbeats during idle sessions.

**How:** `registry.js` already does `JSON.stringify` comparison in `applyMediaSnapshot`. Expose a `hasChanged()` / `isDirty` flag. In `transport.js#push()`, send a lightweight ping object instead of the full payload when nothing changed.

```javascript
// transport.js
async #push() {
  const dirty = this.#registry.isDirty();
  const payload = dirty
    ? this.#getFullPayload()          // full { browserId, browserName, tabs[] }
    : this.#getPingPayload();         // { browserId, seq: this.#seq++, ping: true }

  if (dirty) this.#registry.clearDirty();

  try {
    const res = await fetch(PUSH_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' }
    });
    // ... handle response
  } catch { return; }
}
```

```javascript
// registry.js — add dirty tracking
#dirty = false;

applyMediaSnapshot(tabId, snapshot) {
  const prev = JSON.stringify(this.#mediaState.get(tabId));
  const next = JSON.stringify(snapshot);
  if (prev !== next) {
    this.#mediaState.set(tabId, snapshot);
    this.#dirty = true;
  }
}

markDirty()   { this.#dirty = true; }
isDirty()     { return this.#dirty; }
clearDirty()  { this.#dirty = false; }
```

All `lifecycle.js` calls that do `schedulePush()` should call `registry.markDirty()` first — tab create/remove/focus are real changes that warrant a full sync.

---

### P1-2 · Extension: Filter meaningless `tabs.onUpdated` events

**File:** `pilpod-companion/src/background/tabs/lifecycle.js`  
**Effort:** 20 min  
**Impact:** Stops tab title flicker, `favIconUrl` loads, and `status: "loading"` from triggering pushes.

```javascript
// lifecycle.js
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only push on changes that PilPod actually displays or acts on
  const relevant = changeInfo.status === 'complete'
    || changeInfo.url !== undefined
    || changeInfo.audible !== undefined
    || changeInfo.mutedInfo !== undefined;

  if (!relevant) return;

  registry.markDirty();
  schedulePush();
});
```

---

### P1-3 · Extension: Stop heartbeat when desktop is unreachable

**File:** `pilpod-companion/src/background/transport/transport.js`  
**Effort:** 45 min  
**Impact:** Eliminates ~4 failed fetch attempts/sec when PilPod is closed. Reduces battery drain, eliminates console noise.

Introduce a simple backoff state machine — this is the `connectionState` / `failCount` referenced in outdated docs but **not currently implemented**. We reintroduce it deliberately:

```javascript
// transport.js
#failCount = 0;
#sleeping = false;
static #MAX_FAILS = 4;           // ~1s of failures → back off
static #SLEEP_INTERVAL_MS = 5000; // retry every 5s when sleeping

async #push() {
  if (this.#sleeping) return; // heartbeat timer still runs; push is gated

  // ... fetch ...
  // on catch:
  this.#failCount++;
  if (this.#failCount >= Transport.#MAX_FAILS) {
    this.#sleeping = true;
    setTimeout(() => this.#wakeAndRetry(), Transport.#SLEEP_INTERVAL_MS);
  }
  return;

  // on success:
  this.#failCount = 0;
  this.#sleeping = false;
}

async #wakeAndRetry() {
  this.#sleeping = false;
  await this.#push(); // one probe; if it fails, failCount increments again
}
```

**Important:** Keep `PUSH_INTERVAL_MS = 250` for the timer itself. The sleeping gate means no actual POSTs go out; reconnect probe is cheap.

---

### P1-4 · Rust: Diff before emitting to UI

**File:** `src-tauri/src/browser_bridge/http.rs`  
**Effort:** 1 hour  
**Impact:** Eliminates the full React re-render on every idle heartbeat. This is the single highest-leverage Rust change.

After parsing the POST body, compare it to the currently stored `BrowserSlot` before inserting and emitting:

```rust
// http.rs (pseudocode — adapt to actual struct)
let incoming = parse_browser_payload(&body)?;

let mut slots = browser_slots.lock().unwrap();
let existing = slots.get(&incoming.browser_id);

let changed = existing
    .map(|e| e.content_hash != incoming.content_hash)
    .unwrap_or(true);

slots.insert(incoming.browser_id.clone(), incoming.clone());
drop(slots);

// Only emit to UI and browser_detector if something actually changed
if changed {
    emit_browsers_to_ui(&app_handle, &state).await;
}

// ALWAYS drain commands (user could have queued one since last POST)
let commands = drain_commands(&browser_commands, &incoming.browser_id);
respond_ok(commands)
```

Add a `content_hash: u64` field to `BrowserSlot` — compute it with `std::hash::DefaultHasher` over the serialized tabs list on insert. This avoids deep equality checks.

```rust
// browser_tabs.rs
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

fn hash_tabs(tabs: &[BrowserTab]) -> u64 {
    let mut h = DefaultHasher::new();
    tabs.hash(&mut h);
    h.finish()
}
```

---

### P1-5 · Rust: Move `emit_fast_to_ui` (GSMTC) off the HTTP handler thread

**File:** `src-tauri/src/browser_bridge/http.rs`  
**Effort:** 45 min  
**Impact:** Unblocks the `tiny_http` loop; eliminates the C-3 bottleneck identified in `PilPod_Arch_Review.md`.

Use `tokio::spawn` (or `std::thread::spawn` if not in async context) to fire the GSMTC emit asynchronously:

```rust
// Instead of:
emit_fast_to_ui(&gsmtc_state, &app_handle); // blocks

// Do:
let handle = app_handle.clone();
let gsmtc = gsmtc_state.clone();
tokio::spawn(async move {
    emit_fast_to_ui(&gsmtc, &handle).await;
});
// respond immediately
```

If `tiny_http` runs on its own OS thread outside Tokio, use a `tokio::sync::mpsc` channel — the HTTP thread sends a message, the Tokio runtime picks it up:

```rust
// setup.rs: create channel
let (gsmtc_tx, mut gsmtc_rx) = tokio::sync::mpsc::unbounded_channel::<GsmtcEmitMsg>();

// HTTP thread: send instead of block
gsmtc_tx.send(GsmtcEmitMsg { browser_id, tabs }).ok();

// Tokio task: receive and emit
tokio::spawn(async move {
    while let Some(msg) = gsmtc_rx.recv().await {
        emit_fast_to_ui_from_msg(msg, &app_handle).await;
    }
});
```

---

### P1-6 · React: Guard `useBrowsers.ts` against identity-equal updates

**File:** `src/features/media-dashboard/hooks/useBrowsers.ts`  
**Effort:** 20 min  
**Impact:** Even if Rust emits more than necessary, React won't re-render if data is structurally equal.

```typescript
// useBrowsers.ts
import { isEqual } from 'lodash'; // or a lightweight deepEqual

listen<DetectedBrowser[]>('browsers://update', (event) => {
  setBrowsers(prev => isEqual(prev, event.payload) ? prev : event.payload);
});
```

React bails out of a re-render if `setState` is called with the same reference. Returning `prev` when equal achieves that.

---

### Phase 1 Summary

| Fix | File(s) | Effort | Impact |
|-----|---------|--------|--------|
| P1-1: Ping vs full payload | `transport.js`, `registry.js` | 30 min | ★★★★★ |
| P1-2: Filter `onUpdated` noise | `lifecycle.js` | 20 min | ★★★ |
| P1-3: Backoff when unreachable | `transport.js` | 45 min | ★★★★ |
| P1-4: Diff before UI emit | `http.rs`, `browser_tabs.rs` | 1 hr | ★★★★★ |
| P1-5: GSMTC off HTTP thread | `http.rs`, `setup.rs` | 45 min | ★★★★ |
| P1-6: React identity guard | `useBrowsers.ts` | 20 min | ★★ |

**Total Phase 1: ~4 hours. Expected result: 80–90% reduction in CPU/network on idle sessions.**

---

## Phase 2 — Architecture Improvements (~1 week)

### P2-1 · Migrate transport to WebSocket

**Files:** `src/browser_bridge/` (new `ws.rs`), `transport.js`  
**Effort:** 2–3 days  
**Why now:** Phase 1 reduces waste on the existing polling path. WebSocket solves the remaining structural problems: command latency, multi-browser overhead, and the polling/3s coupling.

#### Rust side — add WS server alongside HTTP

Keep the HTTP endpoint alive as a fallback for older extension versions. Add a WS server on the same port (or `17400`):

```rust
// browser_bridge/ws.rs — use tokio-tungstenite or axum with ws feature
// One connection per browser profile
// Messages: { type: "sync" | "ping" | "cmd" } JSON frames
```

Each browser profile maintains one persistent WS connection. On message receipt:

- `ping` → update `last_seen`; respond with any queued commands
- `sync` → full slot replace + diff check → conditional UI emit

Commands: **push immediately** over the WS connection when enqueued. No waiting for next heartbeat. This achieves the <100ms latency goal.

```rust
// command.rs — when a command is enqueued, push it directly if WS connected
if let Some(ws_sender) = ws_connections.get(&browser_id) {
    ws_sender.send(CommandFrame { commands: vec![cmd] }).ok();
}
```

#### Extension side

```javascript
// transport.js — WebSocket path
class WsTransport {
  #ws = null;
  #pingTimer = null;

  connect() {
    this.#ws = new WebSocket('ws://127.0.0.1:17399/ws');
    this.#ws.onopen    = () => this.#startPing();
    this.#ws.onmessage = (e) => this.#handleServerMessage(JSON.parse(e.data));
    this.#ws.onclose   = () => this.#scheduleReconnect();
    this.#ws.onerror   = () => {}; // onclose fires after
  }

  #startPing() {
    this.#pingTimer = setInterval(() => {
      if (this.#registry.isDirty()) {
        this.#send({ type: 'sync', ...this.#getFullPayload() });
        this.#registry.clearDirty();
      } else {
        this.#send({ type: 'ping', browserId: BROWSER_ID, seq: this.#seq++ });
      }
    }, PUSH_INTERVAL_MS); // keep 250ms ping; but sync only on dirty
  }

  #handleServerMessage(msg) {
    if (msg.commands?.length) dispatchCommands(msg.commands);
    if (msg.syncNow) this.#forceSyncNext = true;
  }

  #scheduleReconnect() {
    clearInterval(this.#pingTimer);
    setTimeout(() => this.connect(), 3000);
  }
}
```

MV3 service workers support WebSocket persistently as long as the SW is alive. The SW stays alive while the WS connection is open (Chrome keeps it running).

#### Fallback strategy

```javascript
// background.js
async function initTransport() {
  try {
    const ws = new WsTransport();
    ws.connect();
    // If WS fails to connect after 2s, fall back to HTTP
    await new Promise((res, rej) => {
      ws.onReady = res;
      setTimeout(rej, 2000);
    });
    return ws;
  } catch {
    return new HttpTransport(); // existing polling path
  }
}
```

---

### P2-2 · Multi-browser scalability

**Files:** `browser_bridge/ws.rs`, `browser_tabs.rs`, `browser_detector.rs`

With WS, each browser profile is one persistent connection — O(N) connections, not O(N × 4 req/s).

Additional changes needed:

- **`browser_detector.rs`:** The 2s OS scanner already diffs before emitting. With WS, only trigger the browser merge when a WS connection opens/closes, not on a timer.
- **`browser_tabs.rs`:** `BrowserCommandsQueue` should be keyed by `(browserId, tabId)` not just `browserId`, to support per-tab command targeting unambiguously across profiles of the same browser.
- **React `useBrowsers.ts`:** The `browsers` array is already keyed by `browserId`. No change needed. Verify `BrowserSessionsPanel.tsx` uses stable keys.

---

### P2-3 · Content script: event-driven detection + URL gate

**Files:** `pilpod-companion/src/content.js`, `content/media/mediaDetector.js`  
**Status:** Implemented (see `docs/MEDIA_DETECTION.md`)

**Problem (original):** 800ms DOM polling in every `http(s)` tab caused false positives and wasted CPU.

**Current architecture:**

- **Event-driven:** `MutationObserver` + media element events with debounced snapshots; MediaSession fallback poll only when needed.
- **URL gate:** Universal inject with early return — `mediaUrlRules.js` allowlist checked before DOM reads on non-media pages.
- **Strict signal:** `hasSignal` is true only when a playing element or `navigator.mediaSession.playbackState === "playing"`.
- **Registry gate:** `mediaGate.js` enforces URL + playing + (active || audible) before attaching `media` to a tab.

The old tick-loop / loose `hasSignal` model below is **superseded** (kept for historical reference).

**File:** `pilpod-companion/src/content.js`  
**Effort:** 1 day  
**Problem:** 800ms `querySelectorAll('video, audio')` in every `http(s)` tab. On a browser with 20 tabs open, that's 20 DOM scans/sec system-wide.

**Fix A (quick):** Pause polling when the tab is not audible and not active:

```javascript
// content.js
let tickInterval = null;

function startTick() {
  tickInterval = setInterval(tick, TICK_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !hasActiveMedia()) {
    clearInterval(tickInterval);
    tickInterval = null;
  } else if (!tickInterval) {
    startTick();
  }
});
```

**Fix B (medium):** Use `MutationObserver` + media events (`play`, `pause`, `timeupdate`) instead of polling. Fire snapshot only on actual media state change. Fall back to polling only for sites that load media dynamically without events.

```javascript
// content.js — event-driven approach
function observeMedia() {
  document.querySelectorAll('video, audio').forEach(attachListeners);

  new MutationObserver((mutations) => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeName === 'VIDEO' || node.nodeName === 'AUDIO') {
          attachListeners(node);
        }
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
}

function attachListeners(el) {
  ['play', 'pause', 'ended', 'timeupdate'].forEach(evt =>
    el.addEventListener(evt, () => sendSnapshot(), { passive: true })
  );
}
```

`timeupdate` fires every ~250ms naturally during playback — use it as the "is playing" heartbeat instead of a DOM poll.

---

### P2-4 · Connection lifecycle: sleep/wake + stale UI

**Files:** `browser_detector.rs`, `BrowserSessionsPanel.tsx`, `transport.js`

#### System sleep/wake

Currently, after a laptop wakes from sleep, the UI shows phantom "playing" tabs until the next successful POST. Fix on Rust side:

```rust
// browser_detector.rs or a new system_events.rs
// Subscribe to OS sleep/wake events via Tauri's window event or a platform API
// On wake: set last_seen to epoch for all slots → triggers offline UI immediately
// Extension reconnects within ~250ms on wake; stale window is minimized
```

#### Stale UI polish

The current `opacity: 0.6` with "offline · cached Xm ago" is correct behavior. Two improvements:

1. Show "Reconnecting…" spinner state during the brief window between wake and reconnect (use a `reconnecting` flag, not just `!extensionConnected`).
2. Clear phantom media state (playing/paused) on the slot when `extensionConnected` goes false — display tabs as "unknown" state rather than stale-playing.

```typescript
// BrowserSessionsPanel.tsx — clear media state on stale
const displayTabs = isStale
  ? browser.tabs.map(t => ({ ...t, mediaState: undefined }))
  : browser.tabs;
```

---

### P2-5 · `tiny_http` → async HTTP server (if staying on HTTP)

**Files:** `browser_bridge/mod.rs`, `http.rs`  
**Effort:** 1–2 days (only if not doing WS migration)  
**Note:** If P2-1 (WebSocket) is done, this is not needed. Include only if WS is deferred.

Replace `tiny_http` with `axum` (already likely in the Tauri dependency tree via `tokio`). This makes the HTTP handler async and removes the single-thread bottleneck:

```toml
# Cargo.toml
axum = { version = "0.7", features = ["json"] }
tokio = { version = "1", features = ["full"] }
```

```rust
// browser_bridge/http.rs
use axum::{routing::post, Router, Json, extract::State};

pub async fn start_bridge(state: AppState) {
    let app = Router::new()
        .route("/browser-tabs", post(handle_post))
        .with_state(state);

    axum::Server::bind(&"127.0.0.1:17399".parse().unwrap())
        .serve(app.into_make_service())
        .await
        .unwrap();
}

async fn handle_post(
    State(state): State<AppState>,
    Json(payload): Json<BrowserPayload>,
) -> Json<PostResponse> {
    // All async; no blocking
}
```

---

## Phase 3 — Maintainability & Protocol Hygiene

### P3-1 · Single source of truth for constants

**Problem:** Timing constants are defined in `constants.js` (extension) and hardcoded in `browser_detector.rs` / `http.rs` (Rust). These must stay in sync manually.

**Fix:** Add a `protocol_version` field to every POST/WS payload. Add a `/capabilities` GET endpoint the extension calls on first connect:

```
GET http://127.0.0.1:17399/capabilities
→ { version: "1.2", maxCommandTTL: 5000, connectedWindowMs: 3000, supportsWebSocket: true }
```

The extension reads these values on startup and adjusts its timing constants accordingly. This allows Rust to drive the protocol without requiring extension updates.

### P3-2 · Protocol versioning

Add `protocolVersion: "1"` to the POST/WS payload root. Rust rejects (400) payloads with unknown major versions. This prevents silent breakage when protocol shape changes.

### P3-3 · Deprecate outdated docs

The following sections in `PILPOD_RUST_INTEGRATION.md` and `PilPod_Beta_doc.md` describe features **not in current code** and should be updated or removed:

- `connectionState` machine (not implemented; P1-3 reintroduces deliberately — update docs)
- `failCount` / stop-after-3-failures (same)
- Any references to `stopHeartbeat()` being unused (P1-3 uses the backoff gate instead)

Add a `CHANGELOG.md` in `pilpod-companion/` tracking protocol changes.

### P3-4 · Test strategy

| Layer | What to test | Tool |
|-------|-------------|------|
| Extension `registry.js` | Dirty tracking, snapshot diffing | Jest (or Vitest) |
| Extension `transport.js` | Ping vs sync logic, backoff state machine | Jest with fetch mock |
| Rust `http.rs` | Hash-based diff, command drain, response shape | `#[tokio::test]` |
| Rust `browser_detector.rs` | Merge logic, `extensionConnected` cutoff | Unit tests |
| Integration | Full POST → UI event round trip | Tauri e2e or manual fixture |

---

## Migration Path (Incremental, Non-Breaking)

```
Week 1 (Phase 1)
  ├─ P1-1: Ping payload (extension + registry)
  ├─ P1-2: Filter onUpdated noise
  ├─ P1-3: Backoff/sleep when unreachable
  ├─ P1-4: Rust hash diff before emit
  ├─ P1-5: GSMTC off HTTP thread
  └─ P1-6: React identity guard
     → Ship. No user-visible change. ~80% less idle CPU/network.

Week 2–3 (Phase 2 core)
  ├─ P2-3A: Content script visibility-aware polling
  ├─ P2-4: Sleep/wake + stale UI media state clear
  ├─ P2-2: Multi-browser slot keying cleanup
  └─ P2-1: WebSocket server in Rust + WS transport in extension
     → WS enabled; HTTP polling kept as fallback.
     → Command latency drops from ≤250ms to <20ms.

Week 4 (Phase 2 polish + Phase 3)
  ├─ P2-3B: Event-driven media detection (MutationObserver)
  ├─ P3-1: /capabilities endpoint
  ├─ P3-2: Protocol version field
  └─ P3-3: Doc cleanup
```

---

## Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| WS blocked by browser security policy on `ws://127.0.0.1` | Low | `127.0.0.1` is explicitly allowed for extension localhost access; test on Chrome + Edge |
| MV3 service worker killed mid-WS | Medium | `onclose` reconnects; SW stays alive while WS open (Chrome behavior) |
| Hash collision in P1-4 | Very low | Use 64-bit hash; collision probability ~1 in 10^18 per comparison |
| Phase 1 ping suppresses a real change | Low | `markDirty()` called on all lifecycle events; only heartbeat timer is gated |
| `tiny_http` queue during WS migration | Low | Keep HTTP path alive in parallel; no cutover until WS stable |
| Backoff (P1-3) delays reconnect after PilPod restart | Low | `SLEEP_INTERVAL_MS = 5000`; acceptable vs current infinite-fail loop |

---

## File Change Summary

### Extension (`pilpod-companion/src/`)

| File | Change |
|------|--------|
| `shared/constants.js` | Add `FAIL_THRESHOLD`, `SLEEP_INTERVAL_MS`, `WS_URL` |
| `background/transport/transport.js` | Ping/sync split, backoff state machine, WS transport class |
| `background/tabs/registry.js` | `isDirty()`, `markDirty()`, `clearDirty()` |
| `background/tabs/lifecycle.js` | Filter `onUpdated` to relevant `changeInfo` fields |
| `content.js` | Visibility-aware polling, MutationObserver media detection |
| `background.js` | `initTransport()` with WS/HTTP fallback |

### Rust (`src-tauri/src/`)

| File | Change |
|------|--------|
| `browser_bridge/http.rs` | Hash diff before emit, GSMTC async fire, keep as fallback |
| `browser_bridge/ws.rs` | **New.** WebSocket server, per-browser connections, push commands |
| `browser_bridge/mod.rs` | Expose both HTTP and WS endpoints |
| `browser_tabs.rs` | Add `content_hash: u64` to `BrowserSlot`; `hash_tabs()` fn |
| `browser_detector.rs` | Wake event hook; clear `last_seen` on system sleep |
| `browser_commands.rs` | Add `/capabilities` GET handler |

### Frontend (`src/`)

| File | Change |
|------|--------|
| `hooks/useBrowsers.ts` | Identity-equal guard on state update |
| `components/BrowserSessionsPanel.tsx` | Clear media state on stale; `reconnecting` UI state |

---

## Constants Reference (post-refactor)

| Constant | Value | Owner | Notes |
|----------|-------|-------|-------|
| `PUSH_INTERVAL_MS` | 250ms | extension | Unchanged; drives both ping and sync |
| `DEBOUNCE_MS` | 60ms | extension | Unchanged |
| `FETCH_TIMEOUT_MS` | 800ms | extension | HTTP fallback only |
| `FAIL_THRESHOLD` | 4 | extension | New: failures before backoff |
| `SLEEP_INTERVAL_MS` | 5000ms | extension | New: retry interval when sleeping |
| `TICK_MS` | 800ms → event-driven | extension | Phase 2: replaced by media events |
| `extension_connected` cutoff | 3s | Rust | Unchanged |
| Command TTL | 5s | Rust | Unchanged (WS makes it moot) |
| `WS_URL` | `ws://127.0.0.1:17399/ws` | extension | Phase 2 |
