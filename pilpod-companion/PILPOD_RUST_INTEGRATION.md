# PilPod Companion — Rust/Tauri Integration

> **For agents working on the Tauri desktop app.**  
> Describes the current wire contract between the MV3 companion extension and the PilPod bridge (v1.3.0).

---

## Endpoints

| Transport | URL | Purpose |
|-----------|-----|---------|
| Capabilities | `GET http://127.0.0.1:17399/capabilities` | Server-owned timing + protocol metadata |
| HTTP fallback | `POST http://127.0.0.1:17399/browser-tabs` | Ping/sync + command drain |
| WebSocket (primary) | `ws://127.0.0.1:17400/ws` | Persistent ping/sync + push commands |

All endpoints are loopback-only. CORS allows extension origins on HTTP routes.

---

## Startup flow

1. Extension service worker loads a stable `browserId` from `chrome.storage.local`.
2. **`GET /capabilities`** — merge server timing into runtime config (`bridgeConfig.js`). On failure, bundled defaults apply.
3. Connect **WebSocket** first; if connect fails within `wsConnectTimeoutMs`, fall back to HTTP polling.
4. Every POST/WS frame includes **`protocolVersion`** (currently `"1"`). Rust rejects unknown major versions with HTTP 400.

---

## Capabilities response

```jsonc
{
  "version": "1.2",              // bridge capabilities schema version
  "protocolVersion": "1",        // wire protocol major version
  "maxCommandTtlMs": 5000,
  "connectedWindowMs": 3000,     // HTTP-only extension_connected cutoff
  "supportsWebSocket": true,
  "pushIntervalMs": 250,
  "debounceMs": 60,
  "fetchTimeoutMs": 800,
  "failThreshold": 4,
  "sleepIntervalMs": 5000,
  "wsConnectTimeoutMs": 2000,
  "wsReconnectMs": 3000,
  "httpPath": "/browser-tabs",
  "wsUrl": "ws://127.0.0.1:17400/ws"
}
```

Rust constants live in `src-tauri/src/browser_bridge/protocol.rs` — this endpoint is the single source of truth the extension reads at runtime.

---

## Message types: ping vs sync

The extension decouples liveness from state updates:

### HTTP ping (no tab changes)

```json
{
  "browserId": "uuid",
  "ping": true,
  "seq": 42,
  "protocolVersion": "1"
}
```

### HTTP sync (full tab list)

```json
{
  "browserId": "uuid",
  "browserName": "Chrome",
  "tabs": [ /* TabPost[] */ ],
  "protocolVersion": "1"
}
```

### WebSocket ping

```json
{
  "type": "ping",
  "browserId": "uuid",
  "seq": 42,
  "protocolVersion": "1"
}
```

### WebSocket sync

```json
{
  "type": "sync",
  "browserId": "uuid",
  "browserName": "Chrome",
  "tabs": [ /* TabPost[] */ ],
  "protocolVersion": "1"
}
```

Rust updates `last_seen` on every ping/sync. UI emit and GSMTC refresh happen only when tab content hash changes (or on reconnect lifecycle events).

---

## Tab payload (`TabPost`)

Each entry in `tabs[]` represents one open tab from the extension registry:

```jsonc
{
  "tabId": 123,
  "windowId": 1,
  "url": "https://example.com/",
  "title": "Example",
  "favIconUrl": "https://example.com/favicon.ico",
  "tabState": "active",       // active | inactive | loading | sleeping | crashed | unknown
  "active": true,
  "windowFocused": true,
  "audible": false,
  "muted": false,
  "pinned": false,
  "index": 0,
  "media": {                  // null when no media signal on the page
    "playbackState": "playing",
    "title": "Track",
    "artist": "Artist",
    "album": "Album",
    "artworkUrl": "https://...",
    "duration": 210.5,
    "currentTime": 45.2,
    "pageVisible": true,
    "userIdleMs": 1200,
    "documentState": "complete"
  }
}
```

There is **no** separate `allTabs` array and **no** `connectionState` field in the payload. Connection state is derived on the Rust side from WS socket presence and heartbeat freshness.

---

## Server response

HTTP POST and WS frames both return:

```json
{
  "ok": true,           // HTTP only
  "commands": [
    { "tabId": 123, "action": "playPause" }
  ],
  "syncNow": false
}
```

| Field | Meaning |
|-------|---------|
| `commands` | Pending media/tab commands for this `browserId` (TTL 5 s in queue; WS clients receive push immediately on enqueue) |
| `syncNow` | When `true`, extension sends a full sync on the next tick |

Supported actions: `playPause`, `next`, `previous`, `focusTab`, `reactivateTab`, `reloadTab`, `closeTab`.

---

## Multi-profile identity

- **`browserId`** — stable UUID per browser profile (`chrome.storage.local`).
- Rust emits **one UI row per `browserId`**, not per OS browser executable.
- `DetectedBrowser.id` = profile UUID; `osBrowserId` = OS-level browser id (e.g. `chrome`).

---

## Connection state (Rust → UI)

| Field | Source |
|-------|--------|
| `extension_connected` | WS socket open **or** `last_seen` within 3 s (HTTP fallback) |
| `extension_reconnecting` | WS disconnected, in reconnect window (e.g. after sleep/wake) |
| Cached tabs | Always shown from last sync; media cleared in UI when stale |

Backoff when desktop unreachable: **`failThreshold = 4`** consecutive failures, then probe every **`sleepIntervalMs = 5000`**. Applies to both HTTP and WS transports.

---

## Protocol versioning

- Extension sends `protocolVersion: "1"` on every frame.
- Missing field treated as v1 (backward compatible).
- Major version ≠ 1 → HTTP 400; WS frame skipped with log.

When breaking the wire format, bump the major version and reject old clients explicitly.

---

## File map (extension)

| File | Role |
|------|------|
| `src/shared/constants.js` | Fallback defaults |
| `src/shared/bridgeConfig.js` | Runtime config + `loadBridgeConfig()` |
| `src/background/transport/wsTransport.js` | Primary transport |
| `src/background/transport/httpTransport.js` | Fallback transport |
| `src/background/tabs/registry.js` | Tab + media state, dirty tracking |
| `src/content.js` | Event-driven media detection |

---

## File map (Rust)

| File | Role |
|------|------|
| `browser_bridge/protocol.rs` | Constants, capabilities, version validation |
| `browser_bridge/http.rs` | POST `/browser-tabs`, GET `/capabilities` |
| `browser_bridge/ws.rs` | WebSocket server |
| `browser_bridge/handler.rs` | Shared ingest, hash diff, command drain |
| `browser_detector.rs` | OS scan + merge with extension slots |
