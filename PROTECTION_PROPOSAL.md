# PilPod — Protection Proposal (Analysis Only, No Changes Made)

Scope: raise the cost of reverse engineering and clone/rebrand theft without touching performance. Based on a full read of `pilpod-companion/`, `src-tauri/`, `src/` (React frontend), and `PROTOCOL.md`.

---

## 0. Headline findings (read this first)

1. **The extension currently ships as fully readable, commented source.** Only the two content scripts are esbuild-bundled to `dist/`; the manifest points the background worker and popup/options UI directly at `src/*.js`. Comments in `client.js`, `bridgeConfig.js`, and `messages.js` document the entire protocol in prose. Anyone loading the store package gets your architecture docs for free. **This is the single biggest leak — fixing the build pipeline is worth more than any obfuscator.**
2. **The bridge port is effectively open to any local process.** `security.rs`: `ALLOWED_EXTENSION_ORIGINS` is empty (any extension accepted), `origin_allowed("")` returns `true` (any native script with no Origin header connects), and `set_pairing_token` is `#[allow(dead_code)]` — the token check always passes. The peer-PID verification (`peer_pid.rs`) exists but is informational, not enforcing.
3. **The Rust binary ships with default release settings** — no `[profile.release]` in `Cargo.toml`, so symbol names, crate paths, and panic strings survive into the .exe, making `strings`/Ghidra work pleasant for an attacker.
4. Note: I found no yt-dlp/download network loop wired in Rust yet (binaries exist in `src-tauri/binaries/`, only `scripts/fetch-binaries.ps1` references them) — so "download hot path" guidance below is forward-looking.

---

## 1. Extension (`pilpod-companion`) — file-by-file

### Protect heavily (protocol/handshake IP — cold path, runs once per connection)

| File | Why | Treatment |
|---|---|---|
| `src/bridge/client.js` | Full handshake state machine: hello→welcome, rev counter, resync, backoff, watchdog | Bundle + aggressive minify/mangle, strip ALL comments, no source maps. Optionally split string constants |
| `src/bridge/protocol/messages.js` | The wire format itself (frame tags, short keys) | Same |
| `src/bridge/sync.js` | Delta/rev consistency logic | Same |
| `src/shared/bridgeConfig.js` | Ports, health probe, `pilpod://connect` launch scheme, browserId minting | Same |

These run at connect/reconnect only — obfuscation overhead is irrelevant here.

### Keep clean — minify only (hot paths, UI-frame-rate sensitive)

| File | Why it must stay lean |
|---|---|
| `src/content/main-world-hooks.js` | Runs in page main world, `document_start`, **all frames of every page**. Per-element media sensors on a 250 ms throttle, Web Audio GainNode. Any obfuscator that wraps calls or adds string-decode indirection multiplies work on every page load and every media event → visible page jank |
| `src/content/content.js` | Same injection profile; relay layer |
| `src/ui/tabRow.js`, `popup.js`, `reconcile.js`, `intent.js` | Popup render/reconcile path; FLIP-style animation timing is fragile |
| `src/background/tabs/*`, `src/background/media/*` (tabReducer, stores, arbiter) | Event-driven per tab-event; standard minification is fine, control-flow flattening is not |

### Build-pipeline changes (the 80/20 winner)

- Extend the esbuild step to bundle **everything** (background, popup, options, bridge) into `dist/` with `--minify --legal-comments=none`, and repoint `manifest.json` at `dist/`. Ship no `src/`, no tests, no `PROTOCOL.md`/`README.md` in the store zip.
- **Chrome Web Store policy caveat:** CWS bans *obfuscated* code (eval-packing, string-array rotation à la javascript-obfuscator) but explicitly allows minification/mangling. Heavy obfuscation of the bridge files risks store rejection or takedown — worse for you than cloning. Recommended ceiling: esbuild/terser with full identifier mangling, property mangling for internal objects, comment stripping, constant inlining. That already turns your self-documenting source into dense one-letter soup, while staying policy-safe and performance-neutral.
- Accept the hard truth: JS shipped to a browser is never secret. The real protocol secret should live in the **handshake design** (§3), not in JS opacity.

---

## 2. Desktop app (Tauri/Rust)

### Binary hardening — zero runtime cost

Add to `src-tauri/Cargo.toml` (build-time only, no perf impact — usually a perf *gain*):

- `[profile.release]`: `strip = "symbols"`, `lto = "thin"` (or `"fat"`), `codegen-units = 1`, `opt-level = 3`, `panic = "abort"` (kills unwind-path strings; verify Tauri compatibility first), `debug = false`.
- This removes function names, mangled crate paths, and most panic/source-path strings — turns a guided tour into flat disassembly.

### Targeted string protection (surgical, cold paths only)

High-value literals worth compile-time string obfuscation (e.g., the `obfstr` crate — decodes on stack at use, ~ns cost):

- `browser_bridge/security.rs`: extension origin IDs, token file path/name
- `browser_bridge/http.rs` + `ws.rs`: `"pilpod"` health signature, frame tag strings, port constants
- Future pairing-token derivation logic

Do **not** blanket-obfuscate strings — do it only in the bridge/security modules.

### What stays raw / bare-metal (hot paths)

- `browser_bridge/ws.rs` frame loop and `prog` handling (5 Hz per subscribed tab, <64-byte frames — the perf budget in PROTOCOL.md leaves no headroom for per-frame crypto or indirection)
- `audio_mixer/mod.rs` WASAPI COM session enumeration (already latency-sensitive OS calls)
- `peer_pid.rs` TCP-table lookups (already cached; keep it connect-time-only)
- Any future yt-dlp/ffmpeg pipe loops — spawn/stream raw

### What NOT to do

- **VM packers / Themida / VMProtect-class tools:** high AV false-positive rate on an unsigned or newly-signed indie app, breaks Tauri updater expectations, real perf cost. Not worth it at this stage.
- Note the biggest clone-value asset is arguably `browser_catalog.rs` (29 KB of browser-detection knowledge) — symbol stripping covers it adequately; its value is the *research*, which a determined cloner rebuilds anyway.
- Sidecars (`yt-dlp.exe`, `ffmpeg.exe`) are public tools — nothing to protect, don't try.
- The Vite/React dashboard bundles into the app resources minified by default; ensure `build.sourcemap` stays off. Extractable regardless — treat frontend as public.

---

## 3. IPC / Bridge — close the open port (highest security ROI)

Current state: loopback WS on 17400, health on 17399. Origin check exists but: empty allowlist, empty-Origin bypass, dead token code. Peer-PID identifies but doesn't enforce.

Proposed layered handshake (all connect-time, **zero hot-path cost**):

1. **Pin origins.** Populate `ALLOWED_EXTENSION_ORIGINS` with your published extension ID(s). One-line change, kills all third-party-extension hijacks.
2. **Kill the empty-Origin allowance in release.** Gate the `origin.is_empty() → true` branch behind `#[cfg(debug_assertions)]`. This alone shuts out every casual local script (curl/wscat/python).
3. **Wire the pairing token (it's already 90% built).** `set_pairing_token` exists in Rust; the options page already has a token field; `hello` already carries it. Missing piece: generate a random token on first run → persist in the app config dir → surface in the desktop UI ("Pair extension" screen) → user pastes once. Reject `hello` with wrong/missing token when paired.
4. **Dynamic session challenge (anti-replay, optional tier).** In `welcome`, include a random nonce; require the next frame to carry `HMAC-SHA256(pairing_token, nonce ‖ sessionId)`. Token never crosses the wire after pairing; a sniffed hello can't be replayed. One HMAC per connection — negligible.
5. **Promote peer-PID to enforcement.** `verified_os_id_for_peer` already maps the socket to the owning exe via the catalog. Reject connections whose owning process isn't a known browser (release builds). Connect-time only.
6. **Health endpoint hygiene.** `/health` stays open (it's discovery), but keep it capability-free — it already is; just don't add fields to it later.

Suggested rollout: 1+2 immediately (two tiny diffs), 3 next release (needs a small UI), 4+5 as hardening tier.

---

## 4. Performance-vs-security risk matrix

| Tier | Measures | Security gain | Perf risk | Compat/other risk |
|---|---|---|---|---|
| **A — Do now (free)** | Bundle+minify whole extension, strip comments/docs from store zip; `[profile.release]` strip/LTO; pin extension origins; kill empty-Origin bypass | High — closes the two open doors and stops shipping your own docs | **None** (LTO usually improves perf) | None |
| **B — Next release (near-free)** | Wire pairing token + pairing UI; peer-PID enforcement; `obfstr` on bridge/security string literals | High — port hijack now requires stealing a per-install secret AND spoofing a browser process | **Negligible** (connect-time only) | Small UX step (one-time pairing); Firefox peer-PID path needs testing |
| **C — Hardening (optional)** | HMAC challenge-response on welcome; property-mangling on bridge JS internals; `panic="abort"` | Medium — anti-replay, denser JS | **Low** (one HMAC/connect) | Verify Tauri plugins tolerate `panic=abort` |
| **D — Not recommended** | javascript-obfuscator on content scripts; VM packers (Themida etc.) on the .exe | Marginal — determined RE gets through anyway | **Real**: page jank in main-world hooks, slower popup | CWS obfuscation-policy rejection; AV false positives; updater breakage |

The 80/20: **Tier A is ~4 small changes and eliminates the majority of casual cloning and port-hijack surface.** Tier B makes a rebrand require actual protocol re-implementation rather than copy-paste.

---

*Awaiting your review — no code has been modified.*
