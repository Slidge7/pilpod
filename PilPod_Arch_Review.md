# PilPod Beta — Architectural Review & Risk Assessment

**Reviewer perspective:** 15+ years shipping production desktop/systems software.  
**Scope:** `src-tauri` (Rust), `extensions/pilpod-companion` (MV3), `src/` (React 19 + Tauri bridge).

---

## CRITICAL — Fix Before Any Wider Release

---

### C-1 · `gsmtc-emit` Thread Starvation Under High Event Churn

**Where:** `src/gsmtc/state.rs` → `emit_fast_to_ui`

Every WinRT callback (`PlaybackInfoChanged`, `MediaPropertiesChanged`, `TimelinePropertiesChanged`) spawns a new `gsmtc-emit` thread. Under high event churn — a scrubbing video, fast metadata updates from a streaming service, or a user rapidly skipping tracks — you will fire multiple concurrent `spawn_blocking` calls, each of which:

- Calls `GetSessions()` (WinRT, blocking)
- Calls `build_snapshot()` (iterates all sessions)
- Locks `browser_tabs` mutex
- Calls `enrich_snapshot_with_audio()` which calls `enumerate_sessions()` (full COM/WASAPI re-enumeration, blocking)
- Calls `app.emit()`

The Tokio `spawn_blocking` pool has a default upper bound of 512 threads, but the real failure mode is subtler: you are doing a full WASAPI `enumerate_sessions()` on every single fired event. WASAPI enumeration opens COM objects and queries process image paths (`QueryFullProcessImageName`) for every audio session. Under rapid event fire this becomes a thundering herd of COM calls, mutex contention on `BrowserTabsMap`, and blocking I/O. There is no debounce, no coalescing, no dirty flag. Five sessions changing simultaneously fires five independent full-pipeline executes.

**Fix:** Add a debounce layer at the emit trigger point — a `tokio::time::sleep`-based trailing-edge coalesce with a dirty flag (e.g., 80–120ms). Only one `gsmtc-emit` job should be in flight at a time; cancel or skip queued ones if a newer event arrives. The `scheduler_blocking` call to WASAPI should move to the full `snapshot()` path (on-demand refresh), not the hot-path `emit_fast_to_ui`. Hot path should skip audio enrichment and let the cached last-known audio data ride until the next full refresh.

---

### C-2 · `resubscribe` Races Against Its Own Cleanup — Token Leak on Session Churn

**Where:** `src/gsmtc/state.rs` → `resubscribe`

The resubscribe flow is:
1. Take old hooks out of the `Mutex<GsmtcInner>`
2. Call `clear_session_hooks` (detaches `RemovePlaybackInfoChanged`, etc.)
3. `GetSessions()` to get new list
4. Register new per-session event hooks
5. Store new hooks back

The gap: between steps 1 and 4, a `SessionsChanged` event can fire again (Windows does this on rapid app start/exit) and call `resubscribe` recursively through the `Arc<Self>` clone in the callback. If the lock is not held across the entire swap, you can have two concurrent `resubscribe` calls — one has already cleared the old hooks and is partway through registering new ones, and the second starts clearing hooks from the first's partially-complete registration. The result is: some sessions end up with double-registered callbacks (fires twice per event), and some tokens are never stored (leaked native COM event registrations, never `Remove`d until process exit).

The `Drop` impl calls `clear_session_hooks`, but if tokens were never stored they can't be cleared.

**Fix:** The entire resubscribe critical section (clear → GetSessions → register → store) must be serialized. A `Mutex` on a "resubscribe in progress" flag, or collapsing the whole thing into one `Mutex<GsmtcInner>` lock held across the swap, is necessary. Alternatively, a dedicated single-threaded executor for GSMTC state mutations.

---

### C-3 · `tiny_http` Single-Threaded Loop Is a Real Bottleneck

**Where:** `src/browser_bridge/http.rs` → `spawn`

`tiny_http`'s `incoming_requests()` is processed sequentially in a single `browser-bridge` thread. Every POST from the extension is:
- Parsed (JSON deserialization)
- Mutex-locked on `BrowserTabsMap` (write)
- Optionally mutex-locked on `gsmtc_slot` (read) and then `BrowserTabsMap` again (inside `emit_fast_to_ui`)
- Response serialized and sent

At 250ms polling, one extension instance sends 4 requests/second. With multiple browser profiles connected (e.g., Chrome + Edge + Brave simultaneously), that's 12+ requests/second minimum. This is manageable today, but the architecture does not scale to the intended "multiple extensions" case mentioned in the question without queuing. More dangerously: if `emit_fast_to_ui` takes >250ms (plausible during WASAPI enumeration), the HTTP thread is blocked, the extension's next POST times out after 800ms, `failCount` increments, and within 3 cycles the extension declares the desktop disconnected. This is a silent self-induced disconnection failure.

**Fix:** Move to `tiny_http`'s multi-threaded mode (it supports it) or replace with `axum`/`hyper` on a Tokio runtime. At minimum, the `emit_fast_to_ui` call in the HTTP handler should be fire-and-forget (spawn, don't block the response loop). Separate the "update state" and "emit to UI" concerns.

---

### C-4 · `pendingKeys` Has No Timeout — Silent Deadlock on Backend Failure

**Where:** `src/features/media-dashboard/hooks/useMediaDashboard.ts`

The `pendingKeys` set is added-to before an `invoke`, and removed-from in the `finally` block. This looks correct until you trace what "fails silently" means here. If Tauri's IPC serialization throws before the `finally` fires (which can happen if the WebView crashes or the Tauri command panics and the error doesn't propagate back cleanly), the key stays in `pendingKeys` permanently for that session lifetime. The button remains a spinner; the user thinks something is in flight. There is no timeout, no watchdog, no TTL on pending entries.

More concretely: `gsmtc_toggle_play_pause` calls into `session_at_index` with a `session_index`. If the session list has been resubscribed between the UI rendering and the command arriving (session order can shift on Windows), the index points to the wrong session or panics with an out-of-bounds. The Rust side returns an error string. The JS `invoke` rejects. The `finally` clears `pendingKeys` correctly in the happy path — but check whether React's error boundary or an unhandled rejection upstream could interrupt the `finally` chain. In React 19's concurrent mode with `useTransition`, suspended renders can make this non-obvious.

**Fix:** Add a per-key TTL (5–10 seconds). Use a `Map<key, timeoutId>` instead of a `Set`. On timeout, clear the key and optionally surface a soft error. Also move Windows session commands from index-based to identity-based (AUMID or a stable session ID) to eliminate the stale-index class of bugs entirely.

---

### C-5 · WASAPI Re-enumeration on Every Volume Set

**Where:** `src/audio_mixer/mod.rs` → `set_session_volume_by_instance_id`

`set_session_volume_by_instance_id` calls `enumerate_sessions()` in full — COM init, default render endpoint open, session manager query, full iteration — just to find one session by instance ID and set its volume. The `AppVolumeSlider` is a controlled range input that fires `onChange` on every pointer move. A user dragging the volume slider generates 30–60 events/second, each of which triggers a full WASAPI re-enumeration. This is objectively expensive and will show up as latency spikes on machines with many audio sessions.

**Fix:** Cache the `ISimpleAudioVolume` COM interface per `instance_id` in a `HashMap` held in app state (with invalidation on `SessionsChanged` or enumeration failure). Volume set becomes a direct COM call with no enumeration. If caching COM interfaces across threads feels fragile, at minimum debounce the slider at the React layer (trailing edge, ~30ms) before invoking the backend.

---

## SCALABILITY BLOCKERS

---

### S-1 · GSMTC Session Index Is Structurally Unstable

**Where:** `src/gsmtc/mapping.rs` → `build_snapshot`, `src/gsmtc/state.rs` → `session_at_index`, `src/features/media-dashboard/lib/windowsMedia.ts` → `winRowKey`

The entire control plane for Windows sessions (play/pause, skip, volume matching) is index-based: `w:${sessionIndex}` is the row key, and `gsmtc_toggle_play_pause` dispatches by `session_index`. GSMTC's `GetSessions()` returns sessions in an order that Windows does not guarantee is stable. Any `SessionsChanged` event (a new app opens media, an app closes) causes `resubscribe` to rebuild the session list, which can shift all indices. If the UI is showing a snapshot from before the reshuffle and the user clicks play on session index 2, they might toggle session index 2 of the new list — a completely different app.

This is a correctness bug that gets worse the more sessions a user has open. With 5+ media apps running simultaneously (common on power users' machines), this will misfire regularly.

**Fix:** Assign sessions stable identity using their AUMID (already present in the DTO as `sourceAppUserModelId`) + process PID as a composite key. Commands should dispatch by stable identity, not position. The frontend key should encode AUMID/PID, not index.

---

### S-2 · Content Script Polls All Tabs Including Inactive Ones

**Where:** `extensions/pilpod-companion/content.js`

`setInterval(tick, 800)` runs in every tab where the content script is injected — that is, every HTTP/HTTPS page. The `lastHasSignal` guard means idle tabs only send one "clear" message and then go quiet. However, `snapshot()` still runs every 800ms in every tab unconditionally: it calls `document.querySelectorAll('video, audio')` on the full DOM, reads `MediaSession` properties, and evaluates `readyState`. On a machine with 50 tabs open, that's ~62 DOM queries per second across the browser's renderer processes. On pages with heavy DOMs (SPAs, Google Docs, Twitter), this is non-trivial.

The `TICK_MS = 800` constant and `PUSH_INTERVAL_MS = 250` are architecturally mismatched: the content script could reduce to 2–3 second polling on pages with no media signal (after initial clear), and switch to event-driven (`play`, `pause`, `ended`, `timeupdate`) on pages that have media, reducing polling to near-zero for inactive pages.

**Fix:** After a tab sends a "no signal" clear, switch its interval to 5–10 seconds. On media-bearing tabs, use `addEventListener('play', ...)` / `pause` / `ended` to trigger `tick()` immediately, and reduce the polling interval to 2–3 seconds as a fallback. The service worker's 250ms heartbeat is acceptable for command draining but should not trigger a full push if nothing changed (the `byTab` change detection is already there — make the timer a no-op more aggressively).

---

### S-3 · The Heuristic Audio Matching Stack Is Order-Dependent and Fragile

**Where:** `src/gsmtc/audio_attach.rs`

The 5-stage GSMTC→WASAPI matcher (`match_gsmtc_by_exe_path` → `match_gsmtc_by_exe_stem_in_aumid` → … → `match_gsmtc_by_media_metadata`) is a sequential fallback chain. Several specific fragility points:

- **Multiple instances of the same browser profile**: Two Chrome windows from the same profile share the same AUMID and exe path. The `unique PID` requirement in stage 4 (`match_gsmtc_by_aumid_token_overlap`) will correctly refuse to match if both are playing audio, resulting in no audio attachment — silent failure with no indication to the user.
- **PWA wrappers**: A PWA installed via Chrome has its own AUMID that may contain Chrome's package family tokens but also custom tokens. It will hit stage 3 and may incorrectly match the wrong Chrome audio session if multiple Chrome-family processes are running.
- **Stage 5 (metadata matching)**: `match_gsmtc_by_media_metadata` matches on display name overlap with title/artist/subtitle/album. Any app that shows its own name as the WASAPI display name and also has that name appear in media metadata (e.g., "Spotify" appearing in both the mixer and a track's album field) will produce a false positive match.
- **The `apply_extension_gsmtc_dedup` Chromium filter**: The list of AUMID substrings (`chrome`, `msedge`, `brave`, etc.) is hardcoded. Electron apps that embed Chromium and register a custom AUMID with none of these strings will slip through deduplication, showing both a GSMTC row and a browser tab row for the same audio. Conversely, a non-browser app that happens to have `chrome` in its AUMID (e.g., a screen-capture tool) gets silently deduplicated.

**Fix (pragmatic, not overengineered):** Replace the sequential heuristic with an explicit confidence score system — each strategy assigns a score and the highest wins, with a minimum threshold below which no match is made (and the user sees "no mixer attached" rather than a wrong match). Add a diagnostic mode (debug build only) that logs the match path per session so you can actually test edge cases. The Chromium AUMID filter should be a user-configurable list or at minimum fetched from a manifest, not a hardcoded array.

---

### S-4 · `browser-bridge` State Is Fully Replaced on Every POST, No Merge

**Where:** `src/browser_bridge/http.rs`

`HashMap::insert` replaces the entire `BrowserSlot` on every POST. The extension owns the delta — tabs that stopped playing are explicitly evicted by the extension. This means the Rust side has no independent view: if a POST is dropped (network hiccup on loopback, which is rare but possible during machine sleep/wake), the desktop state diverges from reality until the next successful POST. With 250ms intervals this usually self-heals, but during machine wake-from-sleep the desktop can show stale "playing" tabs for up to the `failCount * 3 = ~750ms` grace period — which is fine — but the `flatten_tabs` 1-second disconnection grace may be too short on machines with slow wake-from-sleep. This isn't a crash, but it's user-visible phantom state.

More concretely: the `focusTab` command is enqueued in `BrowserCommandsQueue` and only drained on the extension's next POST. If the extension is reloading (e.g., Chrome update) at the moment a `focusTab` is enqueued, that command is never consumed. There is no retry, no acknowledgment, no timeout on the command queue. Commands can sit in the queue indefinitely if the extension never POSTs again for that `browser_id`.

**Fix:** Add a TTL to queued commands (5 seconds is sufficient). On `focusTab`, the Win32 `spawn_raise_browser_window` is already a fallback path — document that it's the primary mechanism and the extension focus is a "nice to have" enhancement, removing the expectation that the command queue is reliable.

---

## MAINTAINABILITY HAZARDS

---

### M-1 · WinRT API Surface Has No Abstraction Layer — Update Brittleness Is Structural

**Where:** All Windows-only Rust modules

Every WinRT call (`TryGetMediaPropertiesAsync`, `GetSessions`, `RequestAsync`, `TryTogglePlayPauseAsync`, etc.) is made directly against the raw `windows` crate bindings, scattered across `state.rs`, `mapping.rs`, `commands.rs`, and `audio_mixer/mod.rs`. There is no abstraction boundary — no trait, no adapter struct — between your application logic and the WinRT API surface.

When Windows pushes a WinRT API update (or deprecates a GSMTC API variant, which has happened before with `GlobalSystemMediaTransportControls` between Win10 versions), every call site needs to be found and updated manually. There is no compile-time indication of which `windows` crate feature flags correspond to which OS version requirements. The `Cargo.toml` feature flags for the `windows` crate are your version contract and they are currently opaque.

**Fix:** Create a `GsmtcAdapter` trait and a `WasapiAdapter` trait. All WinRT/COM calls live in the impl. Application logic (`state.rs`, `audio_attach.rs`) calls through the trait. This also makes unit testing possible (swap in a mock adapter) and makes OS API changes a single-file concern.

---

### M-2 · `gsmtc_init` Thread Failure Is Silent to the User

**Where:** `src/app/setup.rs`

If `GsmtcState::create` fails (WinRT unavailable, wrong Windows version, COM failure), the code logs to stderr and returns — the `gsmtc_slot` remains `None`. The app starts normally. The UI calls `gsmtc_refresh` → which tries to read state from `Arc<GsmtcState>` managed on the app → which was never `manage`d → Tauri returns an error → `useMediaDashboard`'s retry loop runs 12 times over ~1.5 seconds → sets `error` state. The user sees "error" in the UI with no explanation of what failed or what to do.

The error string from WinRT's `message()` is the raw COM HRESULT message, which is meaningless to a user ("The RPC server is unavailable." for example). There's also no way to distinguish "GSMTC not supported on this Windows build" from "GSMTC temporarily unavailable" from "you need to run as a different user."

**Fix:** Implement a structured startup error type with user-facing explanations. Surface it via a dedicated Tauri event emitted from the `gsmtc-init` thread on failure, rather than relying on the retry-and-fail path. Give the user an actionable message ("Windows Media Controls are unavailable on this system. PilPod requires Windows 10 build 1809 or later.").

---

### M-3 · `focusBrowserTab` Races With Always-On-Top State

**Where:** `src/features/media-dashboard/hooks/useMediaDashboard.ts` → `focusBrowserTab`

The focus flow is: (1) set `alwaysOnTop = false` in state, (2) call `setAlwaysOnTop(false)` on the window, (3) save `"0"` to `localStorage`, (4) wait 50ms, (5) invoke `browser_media_control`. The 50ms delay is a heuristic — it assumes the OS will have lowered PilPod below the target browser window within 50ms after `setAlwaysOnTop(false)`. This is not guaranteed. On a loaded system or with compositor overhead, the window stack may not have updated in 50ms, and PilPod remains on top during the browser focus attempt, blocking it.

More subtly: if the user clicks a different UI element within that 50ms (possible given no UI lock during this delay), `alwaysOnTop` state may have changed again, and the `localStorage` write at step 3 is now stale. The always-on-top state in the UI, in localStorage, and in the actual window property can briefly diverge.

**Fix:** Use an event-driven approach: listen for the Tauri window's `focus` event on the target window rather than a fixed delay. If that's not available through the Tauri API, increase the delay to 150ms and add a `windowTransitionLock` guard (it already exists — use it here too) to block re-entry during the focus sequence.

---

### M-4 · `CSP: null` in Production Config Is a Security Posture Issue

**Where:** `src-tauri/tauri.conf.json`

`"csp": null` disables Content Security Policy entirely. In a Tauri 2 app with a transparent, undecorated window that runs on loopback and manages user audio/media sessions, the attack surface is limited — but if a dependency ever introduces an XSS vector in the React layer, there is no CSP backstop. The `faviconFromUrl` function in `browserMedia.ts` already constructs a URL from user-controlled hostname data (the browser tab's URL) and passes it to an `<img>` src — a CSP `img-src` directive would sandbox this to known-safe origins.

**Fix:** Define an explicit CSP at minimum allowing `default-src 'self'`, `img-src 'self' data: https://www.google.com` (for favicons), and `connect-src http://127.0.0.1:17399`. This is a 2-line config change with no functional impact.

---

### M-5 · React State Thrashing on High-Frequency Snapshots Is Unmitigated

**Where:** `src/features/media-dashboard/hooks/useMediaDashboard.ts` — `listen` for `gsmtc://update`

Every `gsmtc://update` event calls `setSnapshot(payload)`, which triggers a full re-render of the entire `MediaDashboard` component tree — all session rows, all sliders, all thumbnails. There is no structural memoization between the snapshot listener and the render tree. `browserProfileGroups` is wrapped in `useMemo`, but `sessions` and `browserTabs` are plain derived values recomputed inline. `WindowsSessionRow` and `BrowserTabRow` are not memoized with `React.memo`.

Under the current `emit_fast_to_ui` design (no debounce), a user with 5 active media sessions that all update simultaneously (e.g., system volume change) fires 5 snapshots in rapid succession, each causing a full tree re-render. With base64 thumbnail data included in the snapshot on the hot path (confirmed: `build_snapshot(manager, false)` skips thumbnails on hot path, but the snapshot struct still carries them from the last full refresh), the serialization and deserialization overhead is non-trivial.

**Fix:** Apply `React.memo` to `WindowsSessionRow` and `BrowserTabRow` with explicit equality functions that compare only the fields they render. Add a debounce at the `listen` callback level (16–32ms, one animation frame) to coalesce burst updates into a single render cycle. Consider splitting the snapshot into a "metadata" portion (titles, playback state) and "audio/volume" portion so volume slider drags don't force metadata rows to re-render.

---

### M-6 · Error Handling Is Structurally "Log and Continue" Throughout

Several systemic gaps worth naming in one place:

- `enrich_snapshot_with_audio` logs on failure and returns early — the UI shows sessions with no audio controls, with no indication to the user that mixer attachment failed. This is the right UX behavior but the reason (COM failure, permission issue, no audio device) is invisible.
- `browser_bridge::http.rs` returns `400` on JSON parse errors but the extension's `fetch` catch block only tracks failure count — it doesn't distinguish "the server is responding with errors" from "the server is unreachable." Three consecutive 400s would mark the desktop as disconnected even though it's running fine.
- `spawn_raise_browser_window` logs internally but has no return path back to the UI. A failed focus attempt (all 8 retry attempts exhausted) gives the user no feedback. They clicked "focus tab," nothing happened, and PilPod provides no explanation.
- `toggle_widget_mode` errors in the window geometry calls (Tauri window API failures) are ignored (`if let Ok`/`?` with no surface). If restore bounds are corrupt or the monitor configuration changed while in widget mode, the window may restore to an off-screen position silently.

**Fix:** Define a structured `PilPodError` enum with variants for each subsystem (GSMTC, WASAPI, Bridge, Window). Emit user-visible toasts or status indicators for non-fatal failures rather than only setting the top-level `error` string (which implies the whole system is broken, not a single subsystem).

---

## Summary Priority Matrix

| ID | Issue | Impact | Effort |
|----|-------|--------|--------|
| C-1 | No debounce on `emit_fast_to_ui` — thundering WASAPI herd | High (CPU/freeze) | Medium |
| C-2 | `resubscribe` token leak under rapid session churn | High (COM leak) | Medium |
| C-3 | Single-threaded HTTP bridge self-disconnects under load | High (UX) | Low–Medium |
| C-4 | `pendingKeys` has no timeout — silent spinner deadlock | Medium (UX) | Low |
| C-5 | Full WASAPI re-enum on every volume slider tick | Medium (CPU) | Low |
| S-1 | Index-based session commands — wrong session on churn | High (correctness) | Medium |
| S-2 | Content script polls all tabs unconditionally | Medium (battery) | Low |
| S-3 | Audio heuristic chain — fragile on edge-case apps | Medium (correctness) | High |
| S-4 | Command queue has no TTL — stale commands never expire | Low–Medium (UX) | Low |
| M-1 | No WinRT abstraction layer — WinAPI updates are O(codebase) | High (maintainability) | High |
| M-2 | Silent GSMTC init failure — opaque error to user | Medium (DX/UX) | Low |
| M-3 | `focusBrowserTab` 50ms delay races on loaded systems | Low–Medium (UX) | Low |
| M-4 | `csp: null` in production | Low (security posture) | Low |
| M-5 | React re-render storm on burst snapshots | Medium (perf) | Low |
| M-6 | Systemic "log and continue" error handling | Medium (DX) | Medium |

**Recommended first sprint:** C-3 (HTTP threading), C-4 (pendingKeys timeout), C-5 (volume debounce), S-1 (stable session identity), M-2 (startup error surfacing), M-5 (React.memo). All are low–medium effort with disproportionate stability returns. C-1 and C-2 are the scariest correctness bugs but require more careful design — tackle after the quick wins stabilize the beta.
