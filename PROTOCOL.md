# PilPod Bridge — Protocol v2 (the contract)

> **Single source of truth.** This file defines the wire protocol between the
> **PilPod desktop app** (Rust/Tauri) and the **PilPod Companion** browser
> extension. The Rust serde types in `src-tauri/src/browser_bridge/protocol/frames.rs`
> and the JS constants in `pilpod-companion/src/bridge/protocol/messages.js` are
> mirrors of this document and **must be changed together in the same commit**.
> The Phase 0 round-trip tests on each side guard against drift.

- **Transport:** a single persistent WebSocket, `ws://127.0.0.1:17400/ws`.
- **Encoding:** JSON text frames. Every frame is an object with a string tag on
  field `t` (serde *internally-tagged* enum). Hot-path frames use short keys.
- **Versioning:** `v = 2`. There is **no** backward compatibility with v1.
- **Discovery (out of band):** `GET http://127.0.0.1:17399/health` →
  `{ "app":"pilpod", "bridge":2, "wsPort":17400, "minExtVersion":"3.0.0" }`.
  Used only to detect "is the app running / which port"; never carries data.

---

## 1. Client → App frames

```jsonc
// hello — first frame after socket open. Identifies + negotiates capabilities.
{ "t":"hello", "v":2, "browserId":"<uuid>",
  "browser":{ "name":"Chrome", "type":"chrome", "version":"126" },
  "extVersion":"3.0.0", "token":"<pairing-token|null>",
  "caps":{ "delta":true, "progress":true, "nav":true } }
//   caps.nav: client understands the `open`/`nav` frames (playlist player).
//   Absent/false ⇒ the app disables playlist playback for this browser.

// full — complete snapshot. Sent right after hello, and on every resync request.
{ "t":"full", "rev":1, "tabs":[ <TabState>, ... ] }

// delta — incremental change. rev increments by exactly 1 per client session.
{ "t":"delta", "rev":2, "upsert":[ <TabState>, ... ], "remove":[ <tabId>, ... ] }

// prog — high-frequency progress for the ACTIVE/subscribed tab only. Lossy. Minimal.
{ "t":"prog", "id":<tabId>, "ct":<currentTime>, "st":1, "d":<duration?> }
//   st: 0 paused | 1 playing ; d included only when it changes

// ack — optional, for commands that requested confirmation.
{ "t":"ack", "id":"<cmdId>", "ok":true, "error":null }

// pong — reply to ping.
{ "t":"pong", "seq":<n> }

// opened — reply to an `open` frame: identity of the created player tab.
// ok:false carries a human-readable error (window create failed, url rejected…).
{ "t":"opened", "id":"<open-frame-id>", "ok":true,
  "tabId":123, "windowId":4, "error":null }

// bye — best-effort on unload.
{ "t":"bye" }
```

### `TabState`

Full object on `full` and on `delta.upsert`. The companion sends the **whole
tab** when any field changes — per-field diffing is not worth the JS CPU.

```jsonc
{ "tabId":123, "windowId":1, "url":"…", "title":"…", "favIconUrl":"…",
  "active":true, "windowFocused":true, "audible":true, "muted":false,
  "pinned":false, "index":4,
  "media": {            // null when no media detected
     "playbackState":"playing",   // playing | paused | none
     "title":"…","artist":"…","album":"…","artworkUrl":"…",
     "duration":215.0,"currentTime":12.3,
     "tabVolume":100,"tabMuted":false,
     "canSeek":true,"canPip":true,"canNext":false,"canPrev":false,
     "inPip":false } }   // inPip: video is currently in a Picture-in-Picture window
```

---

## 2. App → Client frames

```jsonc
// welcome — response to hello. Server-driven config (replaces v1 GET /capabilities).
{ "t":"welcome", "v":2, "bridge":"2.0", "sessionId":"…",
  "caps":{ "progressHz":5, "idlePingMs":15000, "deltaDebounceMs":40, "maxTabs":500 } }

// cmd — single control, pushed IMMEDIATELY (no draining). id for optional ack/metrics.
{ "t":"cmd", "id":"c-9", "tabId":123, "action":"playPause", "value":null }

// cmds — batch of controls.
{ "t":"cmds", "items":[ { "id":"c-10","tabId":1,"action":"seek","value":42.0 }, … ] }

// resync — ask the client to (re)send a full snapshot (rev gap / after app resume).
{ "t":"resync" }

// sub / unsub — subscribe/unsubscribe high-freq progress for one tab.
{ "t":"sub", "tabId":123 }
{ "t":"unsub", "tabId":123 }

// ping
{ "t":"ping", "seq":<n> }

// open — create the playlist player tab (requires hello.caps.nav).
// newWindow:true ⇒ chrome.windows.create({url}); else chrome.tabs.create({url}).
// Client MUST reply with `opened` carrying the created tabId/windowId; the new
// tab then flows into normal delta sync like any other tab.
{ "t":"open", "id":"o-1", "url":"https://…", "newWindow":true }

// nav — navigate an existing tab to a new URL (requires hello.caps.nav).
// chrome.tabs.update(tabId, {url}). No dedicated reply — the resulting tab
// change arrives as a normal delta. Unknown tabId ⇒ `ack {ok:false}` optional.
{ "t":"nav", "id":"n-2", "tabId":123, "url":"https://…" }
```

### `action` enum (shared, both sides)

```
playPause | next | previous | seek | setTabVolume | muteTab | pip |
focusTab | focusWindow | reactivateTab | reloadTab | closeTab
```

`value` semantics: `seek` → seconds (f64); `setTabVolume` → 0–600 percentage
(100 = native 100%); `muteTab` → 1 = mute, 0 = unmute; `focusWindow` →
the `windowId` to focus (`tabId` is ignored); all others → `null`.

---

## 3. Consistency model

- `rev` is monotonic per client session, starting at the `full` that follows
  `hello`. The server stores `last_rev`. If an incoming `delta.rev != last_rev+1`,
  the server replies `resync` and ignores deltas until the next `full`.
- TCP guarantees in-order delivery, so gaps only occur across reconnects — and a
  reconnect always begins with `hello` → `full`. This keeps deltas safe and cheap.
- `prog` frames carry no `rev` and may be dropped freely.

---

## 4. Performance budget (targets)

| Metric | Target |
|--------|--------|
| Control latency (UI click → content script acts) | **< 50 ms p95** |
| Idle uplink traffic | **1 frame / 15 s** per browser |
| `prog` frame size | **< 64 bytes**; rate capped by `welcome.caps.progressHz` |
| Single-tab change | **one** `delta` with one `upsert`, not the whole list |

---

## 5. Security

1. **Origin allowlist (default).** The WS upgrade `Origin` must equal a known
   `chrome-extension://<ID>` / `moz-extension://<ID>`. Web pages cannot forge it.
2. **Pairing token (hardening).** App generates a token on first run and shows it
   in the UI; the user pastes it into the extension options page. Every `hello`
   carries `token`; the server rejects mismatches.
3. **Min-version gate** via `/health.minExtVersion` and `hello.extVersion`.
