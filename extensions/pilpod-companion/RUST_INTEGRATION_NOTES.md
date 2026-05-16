# PilPod Extension — Rust/Tauri Integration Notes
# ══════════════════════════════════════════════════
# This file is a briefing for the Tauri desktop project.
# Read it before touching any /browser-media handler.

## What changed in the extension (v1.0.0)

### 1. Browser name is now sent in every payload
The POST body now includes a `browserName` string field:

  "Brave" | "Opera" | "Arc" | "Edge" | "Vivaldi" | "Firefox"
| "Chrome" | "Chromium" | "Safari" | "Unknown"

Detection uses the `navigator.userAgentData.brands` array first (modern
Chromium UA-CH API, most accurate) and falls back to UA string parsing.
You can display this in your browser tile / source label.

### 2. Tab entries are now reliably clean — no ghost tabs
Old problem: closed tabs would linger in your media list.
Fix: the extension now handles all of:

  - chrome.tabs.onRemoved     → tab closed
  - chrome.tabs.onUpdated     → navigation (status === "loading")
  - chrome.tabs.onReplaced    → prerender/bfcache swap
  - chrome.windows.onRemoved  → whole window closed (prunes by querying live tabs)

When a tab is evicted, a push is sent immediately so your Rust side sees
the removal within the next 250ms heartbeat cycle at worst (usually <60ms
via the debounce path).

### 3. Media detection is much stricter
Old problem: tabs with empty <video> elements (ads, analytics pixels,
background animations) would appear in the media list.
Fix: content.js now only sets `hasSignal = true` when:
  - At least one <video> or <audio> has readyState >= 1 (metadata loaded), OR
  - navigator.mediaSession.metadata.title is non-empty.
The Rust side will never see a tab entry without genuine media.

### 4. Play/pause now works universally, not just YouTube
Old problem: play/pause via keyboard events only worked on YouTube.
Fix: three-tier strategy in content.js:
  1. HTMLMediaElement.play() / .pause() — works on any site
  2. navigator.mediaSession action handler — Spotify, SoundCloud, etc.
  3. Synthetic MediaPlayPause keyboard event — last resort fallback
Track skip (next/previous) uses the same two-tier approach (MediaSession
handler first, then synthetic keyboard event).

### 5. Connection health is now reported
The payload now includes `"connectionState": "connected" | "disconnected"`.
The extension marks itself as disconnected after 3 consecutive POST failures
and flips back to connected on the next successful POST.
Recommended Rust handling: if you receive a push, the browser is obviously
reachable — ignore the field for liveness. But if you have NOT received
a push in >1s AND the last received state was "disconnected", hide that
browser's tile (don't just grey it out, fully remove it from the list).

### 6. Additional fields in each tab row
Each tab object in the `tabs` array now includes:
  - `duration`    (number, seconds, 0 if unknown)
  - `currentTime` (number, seconds, 0 if unknown)
These let you render a scrub bar or time display in the desktop UI.

---

## Updated POST payload shape

```json
{
  "browserId":       "uuid-v4-string",
  "browserName":     "Brave",
  "connectionState": "connected",
  "tabs": [
    {
      "tabId":         42,
      "browserId":     "uuid-v4-string",
      "url":           "https://open.spotify.com/...",
      "title":         "Song Name",
      "artist":        "Artist Name",
      "album":         "Album Name",
      "playbackState": "playing",
      "artworkUrl":    "https://...",
      "duration":      213.4,
      "currentTime":   87.1
    }
  ]
}
```

`playbackState` is one of: `"playing"` | `"paused"` | `"none"`

---

## Expected POST response shape (unchanged, but documented here)

```json
{
  "commands": [
    { "tabId": 42, "action": "playPause" },
    { "tabId": 42, "action": "next"      },
    { "tabId": 42, "action": "previous"  },
    { "tabId": 42, "action": "focusTab"  }
  ]
}
```

### focusTab — navigate the user to the tab

Send `"action": "focusTab"` with the target `tabId` to bring that browser tab
to the foreground.  The extension will:

1. Query the tab to get its `windowId`.
2. Call `chrome.windows.update(windowId, { focused: true })` — raises the
   browser window above other applications on the OS level.
3. Call `chrome.tabs.update(tabId, { active: true })` — switches to that tab
   within the window.

This works on all Chromium-based browsers (Chrome, Brave, Edge, Opera,
Vivaldi, Arc) and Firefox.  No content script is involved — it is handled
entirely in the background service worker.

If the tab was closed between your last received push and the command, the
extension evicts it and sends a fresh push within ~60ms so your list updates.

**Typical Rust usage:**
```rust
// User clicks "Go to tab" in the desktop UI
commands.push(Command { tab_id: tab_id, action: "focusTab".into() });
// Include in the next POST reply body
```

Return `{ "commands": [] }` (or `{}`) when there are no pending commands.

---

## Timing contract

| Direction         | Latency              | Notes                                  |
|-------------------|----------------------|----------------------------------------|
| State → Rust      | ≤60ms after change   | Debounce path (change-triggered push)  |
| State → Rust      | ≤250ms always        | Periodic heartbeat                     |
| Command → browser | ≤250ms after command | Command must appear in the next reply  |

For snappier command execution:  the desktop can issue a command and immediately
poll /browser-media in the response body of its own reply.  The extension
sends a push within 60ms of the play/pause state change, so you'll see the
updated playbackState in the following heartbeat.

---

## Migration checklist for the Rust side

- [ ] Add `browser_name: String` to your browser/tab model
- [ ] Add `duration: f64` and `current_time: f64` to your tab model
- [ ] Add `connection_state: String` to your browser model
- [ ] Remove any "grace period" / tombstone logic you had for ghost tabs
      — the extension now handles lifecycle cleanly
- [ ] Update your media list removal logic: remove a tab row when it
      disappears from the `tabs` array (no need for a timeout / delay)
- [ ] If you had YouTube-specific play/pause handling, remove it —
      the extension now handles all sites uniformly
- [ ] Add a "Go to tab" / "Focus" button in your media tile UI that sends
      `{ "tabId": id, "action": "focusTab" }` in the next POST reply
