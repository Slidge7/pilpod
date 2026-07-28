# In-App Playlist Player — Plan

> **Goal.** A second playback target for vault playlists: instead of driving a
> tab in a connected browser, PilPod plays the playlist **inside its own OS
> webview**, in a phone-shaped, chrome-free window where the video fills the
> whole surface.
>
> **Hard constraint honoured throughout:** the PilPod Companion extension is
> **not touched**. `PROTOCOL.md` stays frozen. The in-app player never speaks
> protocol v2 — it reuses the *shapes* (`BrowserTab` / `TabMedia`, the `action`
> enum) so the whole existing UI keeps working, but the transport is local.

---

## 0. Decisions (locked)

| Question | Decision |
|---|---|
| Render engine | **Two paths, chosen per track by `track_url::stage_plan`.** Most sites: load the real page with a mobile user-agent and let the injected agent strip it to its `<video>`. **YouTube: PilPod's own stage page driving the IFrame Player API in an iframe.** Neither shortcut works for YouTube — `m.youtube.com/watch` renders a thumbnail and an "Open App" bar with *no `<video>` element until the user taps*, and navigating straight to `/embed/<id>` fails with **Error 153**, because a top-level navigation carries no referrer and YouTube requires one for embeds. An iframe on our own origin has a referrer, and the API gives exact play/pause/seek/volume plus a real `ENDED` event. |
| Window | **Dedicated phone-shaped window** (`pilpod-player`), decorations off, created on start and destroyed on stop. It hosts **two tiled webviews**: `player-stage` (the site page, a 16:9 rectangle across the top) and `player-ui` (PilPod's React playlist UI below it). Requires Tauri's `unstable` feature for multi-webview windows. |
| Site scope | **Any `http(s)` URL, best effort** — a generic adapter plus per-host overrides. |
| Controls | The injected agent **plays the role of the companion content script**: it reports media state and executes the same `action` set. PilPod's existing media UI (seek bar, volume, transport) drives it unchanged. |

### Known engine limits (accept, don't fight)

* **No Widevine in WebView2** ⇒ DRM sites (Spotify, Netflix, Prime…) cannot play
  in-app. They must keep using the browser target. Detect + surface a clear
  message rather than failing silently.
* **Autoplay** requires `--autoplay-policy=no-user-gesture-required` in the
  webview's additional browser args, otherwise auto-advance stalls on track 2.
* **`eval` carries no user activation** ⇒ APIs gated on transient activation
  (`requestPictureInPicture`, `requestFullscreen`) can only be triggered from the
  agent's own overlay click, not from a host-side command. Phase 1/2 therefore
  report `canPip: false`; Phase 3 revisits via the overlay.

---

## 1. Architecture

### The player window

```text
┌───────────────────────────────┐
│  player-stage  (remote site)  │  16:9 across the top. The agent strips the
│  video only, chrome stripped  │  page down to its <video>. Granted nothing.
├───────────────────────────────┤
│  player-ui     (PilPod React) │  header (drag/close) · now playing ·
│  transport · list · footer    │  seek/transport/modes · track list · footer
└───────────────────────────────┘
```

Two webviews rather than one page: PilPod's chrome stays real React with real
IPC instead of DOM injected into someone else's document, and a site redesign
can only ever affect the stage. They are tiled (not overlaid) and re-tiled on
every resize by `window::relayout`.

```
                    ┌───────────────────────────── main window (React) ─────────┐
                    │  MediaDashboard · PlaylistPlayerCard · PlaylistDetail      │
                    │  (unchanged control surface)                              │
                    └───▲───────────────────────────────────┬───────────────────┘
      browsers://update │                                   │ browser_media_control
        player://update │                                   │ player_* commands
                    ┌───┴───────────────────────────────────▼───────────────────┐
                    │                     Rust core                             │
                    │                                                           │
                    │  playlist_player ──── PlaybackTarget ────┐                │
                    │    (session, order, repeat, shuffle)     │                │
                    │            │                            │                │
                    │            │ Browser(browser_id)        │ InApp          │
                    │            ▼                            ▼                │
                    │   browser_bridge (WS, protocol v2)   inapp_player         │
                    └────────────┬─────────────────────────────┬───────────────┘
                                 │ open/nav/cmd                │ navigate/eval
                                 ▼                             ▼
                         Companion extension            pilpod-player window
                         (UNCHANGED)                    (site page + agent.js)
```

`inapp_player` is a **sibling of the browser bridge, not a layer on top of it**.
It exposes exactly the two things the rest of the app needs:

1. `snapshot()` → an optional `BrowserTab` (the "tab" the player is showing),
2. `send_command(action, value)` → executes the extension's `action` enum in the
   page.

Everything downstream (dashboard cards, seek bar, volume, playlist auto-advance)
consumes those two through the seams it already has.

### Integration seams (kept deliberately small — mirroring `playlist_player`'s style)

| File | Change |
|---|---|
| `app/setup.rs` | `inapp_player::init(app)` — one managed handle. |
| `app/handlers.rs` | Register the new commands. |
| `browser_bridge/command.rs` | `browser_media_control`: if `browser_id == INAPP_BROWSER_ID` → `inapp_player::send_command`, else the existing WS path. **One `if`.** |
| `browser_detector.rs` | `build_browsers_payload`: append `inapp_player::as_detected_browser()` when a session exists. **One `push`.** |
| `playlist_player/*` | `PlaybackTarget` + nav dispatch (see §3). |
| `platform/stub_commands.rs` | Non-Windows stubs. |

No other file in the browser/bridge path is touched, so the hot tab-sync path
stays exactly as fast as it is today.

### New module layout

```
src-tauri/src/inapp_player/
├── mod.rs         public API + managed handle + the 3 seam functions
├── window.rs      webview window lifecycle (create / navigate / close)
├── agent.rs       agent script assembly (include_str! + per-host adapter pick)
├── bridge.rs      page → Rust channel: parse, validate, throttle
├── state.rs       pure state: report → BrowserTab/TabMedia mapping (unit-tested)
├── commands.rs    #[tauri::command] shells
└── agent/
    ├── agent.js       core: media discovery, reporting, command execution
    ├── cinema.css     "video fills the window, nothing else exists"
    └── adapters.js    per-host quirks (youtube, generic fallback)
```

`src/features/playlist-player/` gains a target picker and the `"inApp"` literal;
no new React feature folder is needed — the playlist template UI **is** the
existing playlist detail page plus the now-playing card.

---

## 2. The page ↔ Rust channel

The player window loads a **remote origin**, which rules out two obvious options:

* `fetch`/`WebSocket` to `127.0.0.1:17400` — killed by the site's
  `connect-src` CSP (YouTube ships a strict one).
* Tauri IPC — gated behind a capability with `remote.urls`; enabling it for
  `https://*` would expose *every* app command to any page the user plays.
  Not acceptable for a "any URL, best effort" scope.

**Chosen channel**

| Direction | Mechanism | Why it is safe |
|---|---|---|
| Rust → page | `webview.eval(js)` | Host-side script execution; CSP does not apply. |
| page → Rust | navigation to `pilpod-ipc://report?…`, cancelled in `on_navigation` | Chromium does not enforce CSP on navigations (`navigate-to` is unimplemented); the navigation is rejected before any load, so the page never unloads. No command surface is exposed. |

`agent.js` sends through a tiny `post()` that tries, in order:
`__TAURI_INTERNALS__.invoke` (used when the page is a *local* URL — the future
embed adapter) → `location.href = 'pilpod-ipc://…'`. Rust accepts both. Swapping
in a better channel later means touching `bridge.rs` and `post()` only.

**Report cadence.** Every message costs a cancelled navigation, which the page
notices, so the channel is deliberately quiet:

* state change (play/pause/track/meta/ended) → immediate,
* progress while playing → **1 Hz**; the UI advances the seek bar locally
  between reports and a fresh report always wins,
* nothing at all while paused and idle.

Payload is the compact form: `{t, ct, d, st, …}` — under ~200 bytes typical.

---

## 3. `playlist_player` becomes target-agnostic

Today `navigate()` builds a `ServerMsg::Nav` and pushes it on a socket. That is
the only place that assumes "browser".

```rust
// state.rs
pub enum PlaybackTarget {
    Browser { browser_id: String },
    InApp,
}
```

* `PlayerSession.browser_id: String` → `PlayerSession.target: PlaybackTarget`
  (`browser_id()` helper keeps the observer code readable).
* `navigate()` / `player_start` dispatch on the target:
  `Browser` → `push_ws_frame(open|nav)`, `InApp` → `inapp_player::open(url)` /
  `inapp_player::navigate(url)`.
* **End-of-track detection differs by design.** The browser path keeps its
  hard-won heuristics (`observe_tabs`, hijack/ad/redirect handling) because the
  extension only gives it periodic snapshots. The in-app path gets the truth
  directly: the agent fires `ended` on the `<video>` element, which calls
  `playlist_player::on_track_ended()`. Fewer moving parts, no epsilon tuning,
  and the existing heuristic code is left untouched.
* `PlayerStateDto` gains `target: "browser" | "inApp"` so the UI can label the
  session; `browserId` stays `None` for in-app sessions.

Everything else — order, shuffle, repeat, `pos_of_item`, the `Step` machine and
its unit tests — is target-independent and unchanged.

---

## 4. The agent (`agent.js`)

One file, no framework, no bundler, `include_str!`-embedded, injected via
`initialization_script` so it runs **before page scripts on every navigation**
(including the site's own redirects).

Responsibilities, in order of importance:

1. **Cinema layout.** Pick the media element (largest `<video>`, else the first
   `<audio>`), then pin it: `position:fixed; inset:0; width:100vw; height:100vh;
   object-fit:contain; z-index:2147483647`, `html,body{background:#000;
   overflow:hidden}`, and everything else visually suppressed. A
   `MutationObserver` (throttled, `requestAnimationFrame`-coalesced) re-applies
   after SPA re-renders. Site-specific selector lists live in `adapters.js`.
2. **Report** media state in the `TabMedia` shape — `playbackState`, `title`,
   `artist`, `artworkUrl` (from `navigator.mediaSession.metadata` when present,
   falling back to `document.title` / OG tags), `duration`, `currentTime`,
   `tabVolume`, `tabMuted`, `canSeek`, `canPip`, `inPip`.
3. **Execute commands** pushed from Rust: `playPause`, `seek`, `setTabVolume`,
   `muteTab`, `pip`, `reloadTab`, `closeTab`. `next`/`previous` are *not*
   handled here — PilPod owns sequencing, exactly as in the browser path.
4. **Loading feedback**: a black overlay with a spinner covers the stage until a
   media element is actually ready, so the window never looks broken while the
   site boots. Window chrome and transport are *not* injected — they live in
   the `player-ui` webview.

Everything the agent touches must tolerate a document that does not exist yet:
it runs as an `initialization_script`, i.e. before `document.documentElement`.

Nothing in the agent is site-specific except `adapters.js`, which is a flat
`{ hostSuffix → { hide[], onReady(), quirks } }` table — adding a site later is a
data edit, not a code change.

---

## 5. Performance / RAM

* **One webview, reused.** Tracks navigate the existing window; the window is
  created on `player_start` and destroyed on `player_stop`. No pooling, no
  hidden background webview. Idle cost when not playing: **zero** (no window, no
  process).
* **Browser args are process-wide, and "unset" is not neutral.** WebView2
  creates one environment per process from the first webview's options; any
  later webview requesting *different* arguments fails environment creation, and
  the window flashes up and dies. wry always sends arguments (its default is the
  `--disable-features=…` group), so a window that sets nothing still disagrees
  with one that does. `inapp_player::agent::BROWSER_ARGS` is the single source
  of truth, mirrored in `tauri.conf.json` (main window), the player window and
  the dev-lab window, with a unit test failing the build if they drift:
  `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` (wry's
  default, which must be repeated), `--autoplay-policy=no-user-gesture-required`
  (auto-advance) and `--disable-background-timer-throttling` (keeps the agent
  reporting while the player sits behind other windows).
* The mobile UA is not cosmetic: mobile pages ship dramatically less DOM/JS than
  desktop ones, which is the single biggest RAM lever available here.
* Rust side: one `Mutex<Option<Session>>`, no polling loop, no extra thread. The
  report path is a parse + a hash compare + (only on change) an emit — the same
  discipline as `browser_tabs::hash_tab`.
* Reports are dropped, not queued, when the state hash is unchanged.

---

## 6. Phases

### Phase 1 — window + navigation *(shippable on its own)*
`inapp_player::{mod,window,agent}` + cinema CSS; `PlaybackTarget`; target picker
in `PlaylistPlayerControls`; start/next/prev/stop drive the window. No reporting
yet: transport is PilPod-side only, auto-advance off.
**Done when:** picking "In app" plays the playlist in a phone-shaped window with
a full-bleed video and no page chrome; next/prev/stop work.

### Phase 2 — the agent bridge
`bridge.rs` + `state.rs` + reporting half of `agent.js`; the pseudo-browser entry
in `build_browsers_payload`; command routing in `browser_media_control`;
`on_track_ended` auto-advance.
**Done when:** the session shows up in the media dashboard like any tab, the
existing seek bar / volume / play-pause drive it, and tracks auto-advance.

### Phase 3 — polish
Overlay (drag + close), YouTube adapter (ad skip, endscreen suppression),
volume > 100 % via a `GainNode`, PiP through the overlay gesture, DRM detection
with a "play in a browser instead" hint, last-used target persisted in vault
settings, window geometry persisted.

### Phase 4 — hardening
Crash/blank-page recovery, `open_timeout` equivalent, memory soak test over a
50-track playlist, unit tests for the mapper and adapter table, and a short
`docs/INAPP_PLAYER.md` describing the agent contract.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| `on_navigation` never fires for the custom scheme on some WebView2 builds | The agent tries Tauri IPC first and the scheme second; a Phase 4 fallback can poll via `ExecuteScript`-with-result through `with_webview`. |
| Sites detect the mobile UA and behave oddly | Adapter table can override the UA per host. |
| DRM / login-walled sites | Explicit detection + message; the browser target remains the answer. |
| Site redesign breaks the cinema CSS | Generic strategy is selector-free (it pins the `<video>` and suppresses the rest); adapters only *improve* it. |
| Playing audio from PilPod's own process shows up in the WASAPI mixer as PilPod | Correct behaviour — the volume mixer now controls the in-app player, which is what a user expects. |
| A window-creation failure looks like "nothing happened" | `on_window_failed` keeps the playlist session and flips it to `Error` with the underlying reason, which the playlist card renders. Failures are never silent. |
