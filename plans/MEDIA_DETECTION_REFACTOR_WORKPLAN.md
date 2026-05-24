# Media Detection Refactor — Work Plan

> **Goal:** Eliminate false positives in browser media detection. A tab is "media" only when it is on an allowlisted URL **and** actively playing **and** is the active tab (or audible — see open decision §0).

---

## How to use this document

Hand each phase to Cursor in order. Every phase ends with a checkpoint — do not move to the next phase until the checkpoint passes. Phases 1–3 are pure logic/tests with no UI impact. Phases 4–6 wire the logic in. Phase 7 is cleanup.

---

## Open decisions — resolve before starting Phase 4

| # | Question | Options | Default if unresolved |
|---|----------|---------|----------------------|
| 0 | Background audio: does `audible: true` override `active: false`? | A) `active \|\| audible` — Spotify in background still counts. B) `active` only — must focus tab. | **Use `active \|\| audible`** (most natural UX for music) |
| 1 | Broad hosts (`soundcloud.com`, `kick.com`, `rumble.com`): whole-host or path-prefix only? | Whole-host is simpler; path-prefix is stricter | **Whole-host for now; add note to tighten later** |
| 2 | Manifest injection strategy: universal inject + early return vs per-host `matches` list | Universal + early-return is maintainable; manifest list is ~50 entries | **Universal inject + early return in script** |

Record your answers at the top of `mediaUrlRules.js` as a comment block.

---

## Phase 1 — New shared module: `mediaUrlRules`

**Scope:** Extension only. No wiring. Pure logic + tests.

### 1.1 Create `pilpod-companion/src/shared/mediaUrlRules.js`

Implement and export:

```js
/**
 * Returns true if the given URL string is on the media allowlist.
 * Uses URL API for parsing; falls back to false on invalid URLs.
 */
export function isMediaUrl(urlString: string): boolean

/**
 * Returns the rule ID that matched, or null.
 * Useful for debug logging and `mediaMatchRule` wire field.
 */
export function matchMediaUrlRule(urlString: string): string | null
```

**Rule groups to implement (in order, stop at first match):**

**Group A — Direct media file/stream extensions** (any host, check pathname + search)
- Extensions: `.mp4`, `.webm`, `.mp3`, `.aac`, `.flac`, `.wav`, `.ogg`, `.m3u8`, `.mpd`
- Rule ID prefix: `direct-`

**Group B — Exact host + path-prefix rules** (use `URL.hostname` + `URL.pathname.startsWith`)

Build a `RULES` array of `{ id, host, path? }` objects covering every row in the allowlist table from the context doc. Path is optional; if omitted, any path on that host matches.

Key entries (full list in context doc):

```
youtube-watch       youtube.com          /watch
youtube-shorts      youtube.com          /shorts
youtu-be            youtu.be             (any)
youtube-music       music.youtube.com    (any)
spotify-track       open.spotify.com     /track
spotify-episode     open.spotify.com     /episode
spotify-playlist    open.spotify.com     /playlist
soundcloud          soundcloud.com       (any)
vimeo               vimeo.com            (any)
twitch              twitch.tv            (any)
twitch-clips        clips.twitch.tv      (any)
netflix             netflix.com          /watch
primevideo          primevideo.com       (any)
amazon-video        amazon.com           /gp/video
disneyplus          disneyplus.com       /video
disneyplus-play     disneyplus.com       /play
hulu                hulu.com             /watch
max                 max.com              /video
play-max            play.max.com         (any)
apple-tv            tv.apple.com         (any)
plex                plex.tv              /web
crunchyroll         crunchyroll.com      /watch
dailymotion         dailymotion.com      /video
facebook-watch      facebook.com         /watch
facebook-reel       facebook.com         /reel
instagram-reel      instagram.com        /reel
instagram-p         instagram.com        /p/
x-spaces            x.com                /i/spaces
twitter-spaces      twitter.com          /i/spaces
vk-video            vk.com               /video
bilibili            bilibili.com         /video
rumble              rumble.com           (any)
odysee              odysee.com           (any)
kick                kick.com             (any)
bbc-iplayer         bbc.co.uk            /iplayer
apple-podcasts      podcasts.apple.com   (any)
spotify-podcast     podcast.spotify.com  (any)
deezer-track        deezer.com           /track
bandcamp            bandcamp.com         /track
mixcloud            mixcloud.com         (any)
audiomack           audiomack.com        (any)
player-fm           player.fm            (any)
archive-org         archive.org          /details
ted-talks           ted.com              /talks
coursera-lecture    coursera.org         /lecture
udemy-course        udemy.com            /course
linkedin-learning   linkedin.com         /learning
skillshare          skillshare.com       /classes
loom                loom.com             /share
wistia              wistia.com           /medias
```

**Group C — Glob rule** (TikTok)
- Pattern: `tiktok.com/@*/video/`
- Implement with a simple regex: `tiktok\.com\/@[^/]+\/video\/`
- Rule ID: `tiktok-video`

**Implementation notes:**
- Strip `www.` prefix from hostname before matching.
- Lowercase hostname and pathname before comparing.
- `isMediaUrl` = `matchMediaUrlRule(url) !== null`.

---

### 1.2 Create `pilpod-companion/src/shared/__tests__/mediaUrlRules.test.js`

Use Vitest. Table-driven. Cover at minimum:

| URL | Expected `isMediaUrl` |
|-----|-----------------------|
| `https://www.youtube.com/` | `false` |
| `https://www.youtube.com/feed/subscriptions` | `false` |
| `https://www.youtube.com/watch?v=abc123` | `true` |
| `https://www.youtube.com/shorts/abc` | `true` |
| `https://youtu.be/abc123` | `true` |
| `https://music.youtube.com/watch?v=abc` | `true` |
| `https://open.spotify.com/track/abc` | `true` |
| `https://open.spotify.com/playlist/abc` | `true` |
| `https://open.spotify.com/` | `false` (no match — root path) |
| `https://www.netflix.com/watch/12345` | `true` |
| `https://www.netflix.com/browse` | `false` |
| `https://www.tiktok.com/@user/video/123` | `true` |
| `https://www.tiktok.com/@user` | `false` |
| `https://example.com/video.mp4` | `true` |
| `https://cdn.example.com/stream.m3u8` | `true` |
| `https://example.com/page.html` | `false` |
| `https://mail.google.com/mail/u/0/` | `false` |
| `https://github.com` | `false` |
| `not-a-url` | `false` |

**Checkpoint:** `npm run test mediaUrlRules` passes with 0 failures.

---

## Phase 2 — New shared module: `mediaGate`

**Scope:** Extension only. Pure logic + tests. No wiring.

### 2.1 Create `pilpod-companion/src/shared/mediaGate.js`

```js
/**
 * Single source of truth for "should this tab be reported as media?"
 *
 * @param {object} opts
 * @param {string}  opts.url           - Tab URL string
 * @param {boolean} opts.tabActive     - chrome.tabs Tab.active
 * @param {boolean} opts.tabAudible    - chrome.tabs Tab.audible
 * @param {object}  opts.snapshot      - MediaSnapshot from content script
 * @param {string}  opts.snapshot.playbackState  - "playing" | "paused" | "none" | ""
 * @returns {{ pass: boolean, reason: string }}
 *   `reason` is a short debug string explaining the gate result.
 */
export function shouldReportMedia({ url, tabActive, tabAudible, snapshot })
```

**Gate logic (all must pass):**

```
1. URL gate:      isMediaUrl(url)                         → fail: "url-not-allowlisted"
2. Playing gate:  snapshot.playbackState === "playing"    → fail: "not-playing"
3. Active gate:   tabActive === true || tabAudible === true  → fail: "tab-not-active"
   (adjust condition based on open decision §0)
```

Return `{ pass: true, reason: "all-gates-passed" }` or `{ pass: false, reason: "<first-failing-gate>" }`.

**Notes:**
- Do NOT import browser APIs here — keep it pure JS so it can run in both extension and test environment.
- The `reason` string is for debug logging only; consumers only check `pass`.

---

### 2.2 Create `pilpod-companion/src/shared/__tests__/mediaGate.test.js`

Cover every gate combination:

| url allowlisted | playbackState | tabActive | tabAudible | Expected `pass` | reason |
|-----------------|--------------|-----------|------------|-----------------|--------|
| true | "playing" | true | false | true | all-gates-passed |
| true | "playing" | false | true | true | all-gates-passed (audible override) |
| true | "playing" | false | false | false | tab-not-active |
| true | "paused" | true | false | false | not-playing |
| true | "" | true | false | false | not-playing |
| false | "playing" | true | false | false | url-not-allowlisted |
| false | "paused" | false | false | false | url-not-allowlisted |

**Checkpoint:** `npm run test mediaGate` passes with 0 failures.

---

## Phase 3 — Align UI filter: `tabHasMedia`

**Scope:** React app (`src/features/media-dashboard/lib/browserMedia.ts`). No extension changes yet. This is safe to land early because it tightens the UI independently.

### 3.1 Rewrite `tabHasMedia` in `browserMedia.ts`

**Current (too loose — remove):**
```ts
export function tabHasMedia(t: BrowserTab): boolean {
  if (t.media == null) return false;
  const state = (t.media.playbackState ?? "").toLowerCase();
  if (state === "playing" || state === "paused") return true;   // ← paused counts
  if ((t.media.title?.trim() ?? "").length > 0) return true;    // ← title counts
  if ((t.media.artist?.trim() ?? "").length > 0) return true;   // ← artist counts
  return (t.media.duration ?? 0) > 0;                           // ← duration counts
}
```

**New (strict — playing only):**
```ts
export function tabHasMedia(t: BrowserTab): boolean {
  if (t.media == null) return false;
  return (t.media.playbackState ?? "").toLowerCase() === "playing";
}
```

**Also update `isTabPlaying`** if it exists — ensure it is consistent.

### 3.2 Verify no other places in React read `.media` outside this function

Search for `t.media`, `tab.media`, `.playbackState`, `.media?.title` in `src/`. Any place that bypasses `tabHasMedia` should be updated to call the function.

### 3.3 Add a unit test for `tabHasMedia`

Create `src/features/media-dashboard/lib/__tests__/browserMedia.test.ts`:

| input | expected |
|-------|----------|
| `media: null` | `false` |
| `media: { playbackState: "playing" }` | `true` |
| `media: { playbackState: "paused", title: "Song", duration: 300 }` | `false` |
| `media: { playbackState: "", title: "Song" }` | `false` |
| `media: { playbackState: "PLAYING" }` (uppercase) | `true` |

**Checkpoint:** All UI tests pass. Manually verify: paused YouTube tab disappears from media list.

---

## Phase 4 — Tighten content script detection

**Scope:** `pilpod-companion/src/content.js` (the live manifest-injected script).

**Goal:** Don't even send a snapshot on non-allowlisted URLs; strengthen `hasSignal`.

### 4.1 Import `isMediaUrl` and `shouldReportMedia`

At the top of `content.js` add:
```js
import { isMediaUrl } from './shared/mediaUrlRules.js';
```

> If `content.js` is not yet an ES module (it's a plain script), either:
> - Convert to ES module and update `manifest.json` to `"type": "module"` for the content script entry, OR
> - Copy `isMediaUrl` logic inline with a `// sync with mediaUrlRules.js` comment and a TODO.
>
> Prefer the ES module path. Verify it works in Chrome MV3 before committing.

### 4.2 Add early-exit URL gate at top of detection logic

```js
// Early exit: do not detect or report media on non-allowlisted URLs
if (!isMediaUrl(location.href)) {
  // Optionally send a clear snapshot to reset any stale state
  // sendSnapshot({ hasSignal: false, playbackState: "none", ... })
  return;
}
```

Place this before any DOM queries or MediaSession reads.

### 4.3 Strengthen `hasSignal` logic

**Current (lines 94–96):**
```js
const hasLoadedElement     = _loadedMedia().length > 0;
const hasMediaSessionTitle = title.length > 0 && (sessionMeta?.title ?? "").length > 0;
const hasSignal            = hasLoadedElement || hasMediaSessionTitle;
```

**New:**
```js
// Only count elements that are actively playing (not paused, not ended, data loaded)
const hasPlayingElement = _loadedMedia().some(
  el => !el.paused && !el.ended && el.readyState > 2
);

// Only count MediaSession if it explicitly reports playing
const hasPlayingSession =
  navigator.mediaSession?.playbackState === "playing";

const hasSignal = hasPlayingElement || hasPlayingSession;
```

Update `_loadedMedia()` if it currently filters on `readyState >= 1` — change to `readyState > 2` (i.e. `HAVE_ENOUGH_DATA`).

### 4.4 Derive `playbackState` strictly

Ensure the `playbackState` field in the outgoing snapshot is:
- `"playing"` — only when an element or MediaSession is actually playing.
- `"paused"` — only when an element exists but is paused (keep for control UI, but gateway will filter it out).
- `"none"` — default/fallback.

Do not set `"playing"` based on title/artist alone.

### 4.5 Add `mediaMatchRule` debug field to snapshot

```js
import { matchMediaUrlRule } from './shared/mediaUrlRules.js';

const mediaMatchRule = matchMediaUrlRule(location.href) ?? undefined;
// Include in snapshot payload: { ..., mediaMatchRule }
```

### 4.6 Manual smoke test (before moving on)

- YouTube home → no snapshot sent (or `hasSignal: false` snapshot).
- YouTube `/watch` paused → snapshot sent with `playbackState: "paused"`, `hasSignal: false` (gate blocks it).
- YouTube `/watch` playing → snapshot sent with `playbackState: "playing"`, `hasSignal: true`.

**Checkpoint:** Console logs on background service worker confirm no media snapshots from YouTube home or paused tabs.

---

## Phase 5 — Registry gate in `applyMediaSnapshot`

**Scope:** `pilpod-companion/src/background/tabs/registry.js`. Defense-in-depth.

### 5.1 Import `shouldReportMedia`

```js
import { shouldReportMedia } from '../shared/mediaGate.js';
// (adjust relative path as needed)
```

### 5.2 Replace blind trust with gate check

**Current (lines 129–134):**
```js
if (p.hasSignal !== true) {
  if (meta.media === null) return false;
  meta.media = null;
  ...
}
// If hasSignal true: attach media unconditionally
```

**New:**
```js
// Resolve tab URL and active state from the registry's stored chrome.tabs data
const tabUrl     = meta.url ?? "";
const tabActive  = meta.active ?? false;
const tabAudible = meta.audible ?? false;

const { pass, reason } = shouldReportMedia({
  url: tabUrl,
  tabActive,
  tabAudible,
  snapshot: p,   // p has .playbackState
});

if (!pass) {
  if (meta.media === null) return false;   // already clear, no change
  meta.media = null;
  console.debug(`[registry] media cleared for tab ${meta.id}: ${reason}`);
  return true;   // state changed
}

// Gate passed — attach media as before
meta.media = buildTabMedia(p);
return true;
```

Ensure `meta.url`, `meta.active`, and `meta.audible` are populated from `chrome.tabs` data (they should be via `tabPost.js` — verify).

### 5.3 Extend `registry.test.js`

Add test cases for:

| url | tabActive | tabAudible | snapshot.playbackState | Expected `meta.media` |
|-----|-----------|------------|----------------------|-----------------------|
| youtube.com/watch | true | false | "playing" | set |
| youtube.com/watch | true | false | "paused" | null |
| youtube.com/ | true | false | "playing" | null (URL not allowlisted) |
| youtube.com/watch | false | false | "playing" | null (not active/audible) |
| youtube.com/watch | false | true | "playing" | set (audible override) |
| example.com | true | false | "playing" | null (URL not allowlisted) |

**Checkpoint:** `npm run test registry` passes. Zero regressions on existing tests.

---

## Phase 6 — Protocol and types cleanup

**Scope:** `protocol.js`, `media.ts`, `dto.rs` comments.

### 6.1 `pilpod-companion/src/shared/protocol.js`

Add `hasSignal` and `mediaMatchRule` to the `MediaSnapshot` typedef:

```js
/**
 * @typedef {object} MediaSnapshot
 * @property {boolean} hasSignal          - True only when a playing element or playing MediaSession detected.
 * @property {string}  playbackState      - "playing" | "paused" | "none"
 * @property {string}  [mediaMatchRule]   - Debug: which allowlist rule matched, or undefined.
 * @property {string}  [title]
 * @property {string}  [artist]
 * @property {string}  [album]
 * @property {string}  [artworkUrl]
 * @property {number}  [duration]
 * @property {number}  [currentTime]
 * @property {boolean} [pageVisible]
 * @property {number}  [userIdleMs]
 * @property {string}  [documentState]
 */
```

### 6.2 `src/types/media.ts`

Add `mediaMatchRule?: string` to `TabMedia` or `BrowserTab` (whichever carries it from Rust). Add a JSDoc comment: *"Populated only when tab media is actively playing on an allowlisted URL."*

### 6.3 `src-tauri/src/gsmtc/dto.rs`

Update the doc comment on `TabMedia` (or the struct field `playback_state`):

```rust
/// Media metadata. Only present when the tab is actively playing content
/// on an allowlisted URL and is the active or audible tab.
```

Also add `media_match_rule: Option<String>` field if you want debug info propagated to Rust (optional — skip if not needed by audio_attach).

**Checkpoint:** `cargo check` passes; TypeScript compiler has no new errors.

---

## Phase 7 — Consolidate content script modules

**Scope:** Dedup `content.js` ↔ `mediaDetector.js` / `mediaController.js`. No logic changes — structural only.

### 7.1 Wire `mediaDetector.js` as the authoritative detector

The refactored logic from Phase 4 should already live in `content.js`. Now move it into `mediaDetector.js` so it becomes the source of truth.

Steps:
1. Copy the refined detection logic (Phase 4 changes) into `pilpod-companion/src/content/media/mediaDetector.js`.
2. Export a `detectMedia(url): MediaSnapshot` function.
3. In `content.js`, replace the inlined detection with `import { detectMedia } from './content/media/mediaDetector.js'`.
4. Keep `content.js` as a thin bootstrap: set up listeners, call `detectMedia`, send snapshot.

### 7.2 Wire `mediaController.js`

It handles play/pause/next commands. Import it in `content.js` and wire the message listener. (It is currently unused but already implemented.)

### 7.3 Validate manifest injection still works

After converting to imports, run `npx web-ext lint` and test in Chrome. ES module content scripts require `"type": "module"` in the manifest content scripts entry — confirm this is set.

### 7.4 Remove dead code

Delete or archive any remaining detection logic that is now unreachable in `content.js` after the import. Leave `activityTracker.js` wired or explicitly mark it `// NOT WIRED — future use`.

**Checkpoint:** Extension loads in Chrome with no console errors. All Phase 5 regression tests still pass.

---

## Phase 8 — Audio attach regression check

**Scope:** `src-tauri/src/gsmtc/audio_attach.rs`. Read-only audit; fix only if broken.

### 8.1 Understand the current matching logic

`audio_attach.rs` matches WASAPI audio sessions to browser tabs using media tab titles. With stricter detection, fewer tabs will have `media`, so fewer titles are available for matching.

### 8.2 Identify if the volume slider breaks

Test with Spotify playing in background (`audible: true`):
- If open decision §0 resolves to `active || audible`, Spotify will still have `media` → titles available → audio attach unaffected.
- If `active` only, Spotify in background loses `media` → audio attach may fail to match.

### 8.3 Fallback (only if broken)

If audio attach breaks, add a `tab.audible` fallback in `audio_attach.rs`: if no `media.title` match, fall back to matching on `tab.audible === true` + GSMTC session process name.

**Checkpoint:** Volume slider correctly isolates browser audio in all test scenarios.

---

## Phase 9 — Manual QA matrix

Run through every row. Check the media dashboard.

| # | Scenario | Expected result | Pass? |
|---|----------|-----------------|-------|
| 1 | `youtube.com` home, preview videos autoplaying in DOM | Not in media list | |
| 2 | `youtube.com/watch` — paused | Not in media list | |
| 3 | `youtube.com/watch` — playing, tab active | In media list | |
| 4 | `youtube.com/watch` — playing, tab in background, not audible | Not in media list | |
| 5 | `youtube.com/watch` — playing, tab in background, audible | In media list (if audible override) | |
| 6 | `open.spotify.com/track/…` — playing | In media list | |
| 7 | `open.spotify.com/` root — playing (hypothetical) | Not in media list | |
| 8 | Random site with `<video>` autoplay ad | Not in media list | |
| 9 | Direct `.mp4` URL playing | In media list | |
| 10 | Navigate from `/watch` to `youtube.com/` home | Media cleared immediately | |
| 11 | Close media tab | Media cleared | |
| 12 | Extension offline / disconnected | Media cleared in UI | |
| 13 | Netflix `/watch/…` playing | In media list | |
| 14 | Twitch stream playing | In media list | |
| 15 | TikTok `/@user/video/123` playing | In media list | |
| 16 | TikTok `/@user` profile page | Not in media list | |

---

## Phase 10 — Update docs

### 10.1 `docs/PILPOD_BRIDGE_REFINEMENT_PLAN.md`

Update the P2-3 content script section to reflect the new event-driven, URL-gated detection.

### 10.2 `PilPod_Beta_doc.md`

Add a deprecation notice at the top:

```
> ⚠️ This document describes the old byTab-only model and old tick loop.
> It is outdated as of the media detection refactor. See MEDIA_DETECTION_REFACTOR_WORKPLAN.md.
```

Do not delete it — it is useful historical reference.

### 10.3 Add `docs/MEDIA_DETECTION.md`

One-page spec covering:
- The three-gate rule (URL + playing + active/audible)
- URL allowlist with the authoritative source of truth (`mediaUrlRules.js`)
- Data flow diagram (content → registry → transport → Rust → React)
- Open decisions log with resolution

---

## Summary of files changed per phase

| Phase | Files modified | Files created |
|-------|---------------|---------------|
| 1 | — | `shared/mediaUrlRules.js`, `shared/__tests__/mediaUrlRules.test.js` |
| 2 | — | `shared/mediaGate.js`, `shared/__tests__/mediaGate.test.js` |
| 3 | `browserMedia.ts` | `lib/__tests__/browserMedia.test.ts` |
| 4 | `content.js` | — |
| 5 | `registry.js`, `registry.test.js` | — |
| 6 | `protocol.js`, `media.ts`, `dto.rs` | — |
| 7 | `content.js`, `mediaDetector.js`, `manifest.json` | — |
| 8 | `audio_attach.rs` (if needed) | — |
| 9 | — (manual QA) | — |
| 10 | `PILPOD_BRIDGE_REFINEMENT_PLAN.md`, `PilPod_Beta_doc.md` | `docs/MEDIA_DETECTION.md` |

---

## Automated test run command

```bash
# Extension tests
cd pilpod-companion && npm run test

# React/UI tests
cd .. && npm run test

# Rust
cd src-tauri && cargo test
```

All three suites must pass green before shipping.
