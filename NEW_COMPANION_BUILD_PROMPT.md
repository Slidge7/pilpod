# Build prompt — PilPod Companion (clean rebuild)

> Paste everything below into a new chat that has access to this repo
> (`pilpod-companion/` and the repo root). It is written as instructions to you,
> the assistant.

---

You are rebuilding the **PilPod Companion** browser extension (MV3, Chrome/Edge)
**from scratch**. The existing `pilpod-companion/` implementation is being
deleted because its rendering architecture is fundamentally wrong (it rebuilds
DOM to reflect state, which causes constant flicker, unreliable controls, and
fighting between data sources). Do **not** port its UI architecture. You *may*
mine it for **domain knowledge only** (see "Salvage" below).

Goal: a **super-smooth, fast, reliable tab + media manager** — a popup that lists
and controls every tab and every playing media across the browser, plus a live
bridge to the PilPod desktop app. It must feel instant and never flicker.

## Product scope

1. **Tab manager** — list all tabs across all windows; search/filter; focus,
   close (with confirm), sleep/discard, reload; show active/audible/muted/sleep
   state; live updates as tabs open/close/move/navigate.
2. **Media manager** — detect media in ANY tab (video/audio, any site) and show a
   single coherent "now playing" per tab: title, artist, artwork, duration,
   position. Controls: play/pause, seek, volume (0–600% with Web Audio gain),
   mute, next/previous, Picture-in-Picture, skip-ad.
3. **Ad-block** — YouTube ad blocking via declarativeNetRequest, toggleable.
4. **Desktop bridge** — a WebSocket client that speaks **protocol v2** to the
   PilPod desktop app. The contract already exists at repo root `PROTOCOL.md` and
   the desktop (Rust/Tauri) already implements it — you MUST keep this contract
   so the desktop app keeps working.

## Non-negotiable architecture principles (these are why the old build failed)

1. **The background service worker is the single source of truth.** It owns the
   canonical `TabStore` and `MediaStore`. The popup is a pure view. Content
   scripts are dumb sensors/actuators. No component holds its own copy of domain
   state.
2. **The UI NEVER does a full re-render of the list or of a card to reflect a
   state change.** Build each row/control once; thereafter mutate only the
   specific node that changed, addressed by a stable id. The list reconciler may
   only insert / remove / move / update-one-field. Rebuilding `innerHTML` or
   "morphing" a card on every update is forbidden. This is the #1 rule.
3. **One media truth per tab (a MediaArbiter).** A tab can have many media
   elements across many frames (main video, ad iframes, autoplay previews,
   MediaSession). The arbiter selects exactly ONE authoritative source per tab
   and ignores the rest. It must be frame-aware (use `sender.frameId`), prefer
   the element that is actually playing, then one with MediaSession metadata,
   then longest duration. It emits a single, stable snapshot per tab. The old
   build let two sources alternate every tick → "dancing duration" and refresh
   storms. Never again.
4. **Every control updates from its own slice of state, independently.** Play
   icon, seekbar, time, volume, mute, badge, title, artwork are each owned by one
   updater bound to one state field. Changing one never re-renders the others.
5. **Optimistic intent for all user actions.** A click sets the desired state
   immediately AND records an intent with a short TTL (~2.5s). The incoming
   high-frequency snapshot stream is subordinate to an active intent: it may not
   override the desired state until it confirms it (intent clears) or the TTL
   expires (reality wins). No poll-and-revert. This is what makes play/pause work
   on the first click.
6. **Event-driven, debounced, delta updates — never polling storms.** Coalesce
   bursts. Progress/position is a separate lossy stream, not part of structural
   state, and must never trigger a list/card render.
7. **Typed message schema.** All cross-context messages (content↔background,
   popup↔background, bridge frames) go through one schema module with explicit
   types/constants. No stringly-typed ad-hoc messages.
8. **MV3 SW resilience.** Persist canonical state to `chrome.storage.session`;
   rehydrate on SW wake; keep the SW alive via the bridge WebSocket when
   connected. Assume the SW can be evicted at any time.
9. **Testable in isolation.** Pure logic (arbiter, reconciler, intent, store,
   codec) lives in plain modules with vitest unit tests. DOM-free where possible.

## Tech / repo facts

- MV3, ES modules, `esbuild` for content-script bundles, popup modules loaded
  directly. `vitest` for tests, `eslint` flat config. Node is available; on this
  sandbox run `npm i @rollup/rollup-linux-x64-gnu --no-save` once if vitest's
  rollup binary is missing.
- The bridge contract is `PROTOCOL.md` (repo root). Keep frames/actions exactly.
- Target Chrome/Edge (Chromium). Firefox is out of scope unless trivial.

## Salvage from the old `pilpod-companion/` before/while deleting

Reuse the **domain knowledge**, not the architecture:
- Media-detection strategies in `src/main-world-hooks.js` (prototype hooks for
  `<video>/<audio>`, the YouTube `#movie_player` controller, MediaSession
  artwork picking) — but feed them into the new MediaArbiter, single-source.
- `src/shared/staticMediaPatterns.js` (known media-site matches).
- Ad-block rules `src/background/adblock/rules/youtube.json` and RuleManager idea.
- Volume-gain-above-100% approach (Web Audio).
- `manifest.json` permissions set; icons.
- `PROTOCOL.md` + the bridge frame shapes.
- **The entire visual design — keep it.** Salvage `src/ui/css/*` verbatim as the
  starting point: `tokens.css` (design tokens), `card.css`, `controls.css`,
  `volSlider.css`, `badge.css`, `header.css`, `search.css`, `globalBar.css`,
  `list.css`, `toast.css`, `animations.css`, `adblock.css`, `icons.css`, plus the
  SVG icon set. The look (glassmorphism, the gradient, the hovers, the
  animations) is good; only the DOM-update behavior was bad. Re-attach the same
  classes to the new component nodes so the appearance is pixel-identical.
Discard: the popup `render()`/`morphNode`/`updateExistingCard` model, the
per-card storage-poller re-render, and any place that rebuilds DOM on update.

## Design system & visual spec (preserve this — it is part of "done")

The new UI must look and feel **identical or better** than the old one. Treat the
existing CSS as the spec and keep these properties:

- **Aesthetic:** dark glassmorphism. Background gradient
  `--bg-grad: linear-gradient(135deg,#0f0c29,#302b63,#24243e)`; translucent glass
  cards (`--glass-bg`, `--glass-border`, subtle top shine `--glass-shine`).
- **Palette/tokens (from `tokens.css`):** accent `#a78bfa` (violet), accent2
  `#60a5fa` (blue), success `#34d399`, danger `#f87171`, warning `#fbbf24`; text
  main/muted/dim at .92/.50/.28 white. Reuse these CSS variables — no hard-coded
  colors in components.
- **Typography:** Inter, 12px base, dark color-scheme. Popup width **360px**,
  max-height 600px, thin custom scrollbar.
- **Every interactive element must have explicit `:hover`, `:focus-visible`,
  `:active`, and disabled states** with smooth `transition`s (≈120–180ms ease).
  Buttons lift/brighten on hover, depress on active; the glass cards highlight
  border/lift slightly on hover. No state should appear instantly without a
  transition.
- **Micro-interactions (keep `animations.css`):** `pp-bounce` on the play button
  when toggled, `pp-slide-in` for newly inserted cards, `pp-spin` for loading,
  `pp-ad-pulse` for the ad-block active indicator. New rows animate in; removed
  rows animate out (the existing close animation: fade + translateX + collapse
  height). These animations are cosmetic only and must never drive or block state.
- **Hover text / tooltips:** every icon-only control (play/pause, prev, next, PiP,
  mute, reload, close, focus/jump, mute-all, pause-all, reset-volumes, refresh,
  ad-block toggle) must have a tooltip via `title=` (or a styled custom tooltip)
  describing its action. Keep the existing titles; add any missing ones.
- **Component states to style:** tab card (active / inactive / audible / muted /
  sleeping/discarded / loading), play button (play / pause / loading), seekbar
  (enabled / disabled / dragging), volume track (0–600 with a 100% mid-tick,
  fill, draggable thumb), state badge, close button (idle / confirm), search
  field (empty / typing / focus), empty state, toast.
- **Accessibility:** keyboard-focusable controls, visible focus ring, adequate
  contrast, respect `prefers-reduced-motion` (disable non-essential animation).

Critically: applying these styles must follow rule #2 — toggle classes / CSS
variables on the already-mounted node; never re-render a card to change a hover
or state class.

## Target module layout (adjust as you see fit, but keep the separation)

```
background/        SW: stores (TabStore, MediaStore), arbiter, lifecycle, bridge,
                   adblock, message router. Single source of truth.
content/           main-world sensors/actuators + isolated bridge (dumb).
ui/                popup: a tiny reactive store-subscription layer; components
                   that each own one node and one state slice; a keyed list
                   reconciler. No full re-renders.
shared/            message schema, types, protocol codec (mirrors PROTOCOL.md),
                   pure helpers.
bridge/            WebSocket client (transport + codec + sync + commands).
```

Pick a minimal reactivity approach (a small observable store with keyed
selectors + per-node binders, or signals). No heavy framework. Whatever you
choose, rule #2 must hold.

## Phased plan — STOP after each phase for the user to test

Work one phase at a time. At the end of each phase: build, lint, run unit tests,
then **STOP and hand the user explicit test steps + acceptance criteria. Do not
start the next phase until they confirm it passes.** Keep diffs small.

**Phase 0 — Skeleton & tooling.** MV3 manifest, esbuild/vitest/eslint, folder
structure, the typed message-schema module, an empty SW and a popup that opens.
*Acceptance:* extension loads unpacked, popup opens, zero console errors, `npm
test`/`lint` pass.

**Phase 1 — TabStore (background, source of truth).** All tab lifecycle listeners
(created/removed/updated/activated/moved/replaced/window focus), seeding, GC of
dead tabs, persistence to `storage.session` + rehydrate on SW wake. Typed query
API. Unit tests for the store reducer. *Acceptance:* a debug view prints the
store; opening/closing/moving/navigating tabs keeps it correct; it survives SW
idle/wake.

**Phase 2 — Popup tab manager (reactive, no re-render) + design system.** The
reactive layer + keyed list reconciler. **Port the salvaged `css/*` design system
and SVG icons**, applied via class/variable toggles on mounted nodes. Render the
tab list once; on store deltas, insert/remove/move/patch single rows only.
Search/filter. Actions: focus, close (confirm), sleep/discard, reload. Every
control has hover/focus/active states, transitions, and a tooltip. *Acceptance:*
visually matches the old design (glass cards, gradient, accents); with 100+ tabs,
searching and acting is instant with zero flicker; hover/active states feel
smooth; new rows slide in and removed rows animate out; opening/closing a tab
updates exactly one row; no full list rebuild (verify via DevTools "paint
flashing"/profiler).

**Phase 3 — Media detection + MediaArbiter (single truth).** Main-world sensors
across all frames → isolated bridge → background arbiter that emits ONE stable
`MediaState` per tab (frame-aware, playing-priority, MediaSession metadata),
debounced; position is a separate lossy stream. Unit tests for the arbiter with
multi-frame/ad/preview candidate sets. *Acceptance:* on YouTube/Spotify/
SoundCloud/generic video, now-playing shows one stable title/artwork/duration
even with ads and sidebar preview videos — no dancing numbers; stopping clears it.

**Phase 4 — Media controls + optimistic intent.** Per-card transport bound to
state slices: play/pause, seek (smooth, intent-locked), volume (0–600 gain),
mute, next/prev, PiP, skip-ad. Optimistic intent + reconciliation + TTL on every
action. Seekbar driven by the position stream, never triggers a render. Unit
tests for the intent reconciler. *Acceptance:* every control works on the FIRST
click; no double-clicking; seekbar smooth; duration stable; controls never flash
or lose their click target while media plays.

**Phase 5 — Ad-block + visual polish pass.** declarativeNetRequest YouTube rules
with a popup/options toggle; keyboard shortcut to open popup; empty/error states.
Full design QA: every control's hover/focus/active/disabled state, tooltips,
transitions, micro-interactions (play bounce, card slide-in/out, loading spin,
ad-pulse), scrollbar, reduced-motion. *Acceptance:* YT ads blocked; toggle
persists; the UI matches the design spec on every state; no instant/janky
transitions; tooltips present on all icon controls.

**Phase 6 — Desktop bridge (protocol v2).** WebSocket client implementing
`PROTOCOL.md` (hello/welcome, full/delta, prog, cmd/cmds, resync, sub/unsub,
ping/pong) reusing the SAME TabStore + MediaArbiter as the only source of truth —
the bridge is just a transport/reader. Backoff+jitter, 15s keepalive, origin
allowlist + optional pairing token, port discovery via `/health`. Unit tests for
the codec (round-trip) and sync (full vs delta, rev gaps). *Acceptance:* launch
the desktop app → tabs and media appear live; desktop controls act in <50ms;
killing/reopening the app auto-reconnects; only the subscribed tab streams
progress; idle uplink ~1 frame/15s.

**Phase 7 — Resilience, performance, tests.** SW eviction/rehydrate correctness;
200+ tabs with flat CPU and no render storms; schema fuzz; reconnect-storm
protection; documented latency/throughput. *Acceptance:* stress and idle/wake
checklists pass; metrics meet targets; full suite green.

## Working agreement

- Before coding, read the relevant old files for domain knowledge and read
  `PROTOCOL.md`. Confirm the plan/assumptions with the user, then build Phase 0.
- After each phase: build + lint + test, then STOP with copy-paste test steps and
  pass/fail acceptance criteria. Wait for the user's "pass" before continuing.
- If you cannot run the live browser yourself, say so and rely on unit tests +
  the user's manual test at each gate. Never claim a UI behavior is verified
  without either a test or the user's confirmation.
- Enforce the non-negotiables on every change. If a requested change would force
  a full re-render or a second media source, push back and propose the
  component-scoped / single-source alternative instead.
