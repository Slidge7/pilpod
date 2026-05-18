# PilPod Browser Extension — Rust/Tauri Integration Update

> **For the Cursor AI agent working on the Tauri desktop app.**  
> This README describes every change made to the browser extension (v1.1.0) and
> exactly what the Rust side needs to handle.  Read it completely before editing
> any Rust files.

---

## What Changed in the Extension

### 1. Payload shape (`POST /browser-media`)

The request body now carries **two tab lists** instead of one.

```jsonc
{
  "browserId":       "uuid-string",
  "browserName":     "Chrome",
  "connectionState": "connected",

  // PRIMARY — tabs that have active media (same as before, with new fields)
  "tabs": [
    {
      "tabId":         123,
      "browserId":     "uuid-string",
      "url":           "https://open.spotify.com/...",
      "title":         "Song Name",
      "artist":        "Artist Name",
      "album":         "Album Name",
      "playbackState": "playing",          // "playing" | "paused" | "none"
      "artworkUrl":    "https://...",
      "duration":      210.5,
      "currentTime":   45.2,
      // NEW fields on media tabs:
      "tabState":      "active"            // see Tab States below
    }
  ],

  // SECONDARY — all OTHER open tabs (no media detected)
  "allTabs": [
    {
      "tabId":      456,
      "windowId":   1,
      "url":        "https://github.com/...",
      "title":      "GitHub",
      "favIconUrl": "https://github.com/favicon.ico",
      "tabState":   "inactive",            // see Tab States below
      "active":     false,
      "pinned":     false,
      "audible":    false,
      "index":      3
    }
  ]
}
```

**Key rule:** A tab appears in either `tabs` OR `allTabs`, never both.

---

### 2. Tab States

Both `TabRow` (media tabs) and `TabMeta` (all-tabs) carry a `tabState` field.

| Value        | Meaning                                                                 |
|--------------|-------------------------------------------------------------------------|
| `"active"`   | Currently focused tab in its window.                                    |
| `"inactive"` | Loaded and visible but not the focused tab.                             |
| `"loading"`  | Currently navigating / loading a page.                                  |
| `"sleeping"` | Browser discarded the renderer to save memory (`tab.discarded = true`). |
| `"crashed"`  | Renderer process crashed.                                               |
| `"unknown"`  | State could not be determined.                                          |

**UI hint:** Show a 💤 badge on `sleeping`, a ⚠️ badge on `crashed`, and a dimmed row for `inactive` tabs. The Rust UI should let users act on these.

---

### 3. Content-script signals (inside media tab snapshots)

Each entry in `tabs[]` now also carries activity hints from the page itself.
These are **informational** — the Rust app can use them for smarter UI but
they are not required for core functionality.

```jsonc
{
  "pageVisible":   true,       // document.visibilityState === "visible"
  "userIdleMs":    120000,     // ms since last user interaction (mouse/key/scroll)
  "documentState": "complete"  // "loading" | "interactive" | "complete"
}
```

Suggested thresholds for the UI:
- `userIdleMs > 300_000` (5 min) → show an "inactive" warning on the tile.
- `pageVisible === false` → tab is in background; dimming is appropriate.

---

### 4. New Commands (Rust → Extension)

The response JSON from `/browser-media` still has the same shape:

```jsonc
{
  "commands": [
    { "tabId": 456, "action": "reactivateTab" }
  ]
}
```

New `action` values to support:

| Action           | Applies to        | What the extension does                                    |
|------------------|-------------------|------------------------------------------------------------|
| `focusTab`       | any tab           | Existing — brings window/tab to foreground. *(unchanged)*  |
| `reactivateTab`  | any tab           | **New** — reloads a sleeping/crashed tab, then focuses it. |
| `reloadTab`      | any tab           | **New** — hard reloads the tab (clears its media entry).   |
| `closeTab`       | any tab           | **New** — closes the tab entirely.                         |
| `playPause`      | media tabs only   | Existing — unchanged.                                      |
| `next`           | media tabs only   | Existing — unchanged.                                      |
| `previous`       | media tabs only   | Existing — unchanged.                                      |

> **Important:** `reactivateTab`, `reloadTab`, and `closeTab` can target **any**
> tabId — it does not have to be a media tab. The extension handles both lists.

---

## Rust-Side Changes Required

### A. Data Structures

Add / update these structs (use `serde` for JSON deserialization):

```rust
/// Received from the extension — media tab (primary list)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabRow {
    pub tab_id:         i64,
    pub browser_id:     String,
    pub url:            String,
    pub title:          String,
    pub artist:         String,
    pub album:          String,
    pub playback_state: String,   // "playing" | "paused" | "none"
    pub artwork_url:    String,
    pub duration:       f64,
    pub current_time:   f64,
    // NEW
    pub tab_state:      String,   // "active" | "inactive" | "loading" | "sleeping" | "crashed" | "unknown"
    #[serde(default)]
    pub page_visible:   bool,
    #[serde(default)]
    pub user_idle_ms:   u64,
    #[serde(default)]
    pub document_state: String,   // "loading" | "interactive" | "complete"
}

/// NEW — non-media tab (secondary list)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabMeta {
    pub tab_id:       i64,
    pub window_id:    i64,
    pub url:          String,
    pub title:        String,
    pub fav_icon_url: String,
    pub tab_state:    String,
    pub active:       bool,
    pub pinned:       bool,
    pub audible:      bool,
    pub index:        u32,
}

/// Top-level payload received at POST /browser-media
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMediaPayload {
    pub browser_id:       String,
    pub browser_name:     String,
    pub connection_state: String,
    pub tabs:             Vec<TabRow>,   // media tabs (primary)
    #[serde(default)]
    pub all_tabs:         Vec<TabMeta>, // all other tabs (secondary)
}
```

---

### B. HTTP Handler (`/browser-media`)

The handler logic is unchanged except:

1. Deserialize `all_tabs` from the payload (it may be absent in old payloads,
   `#[serde(default)]` handles that gracefully).
2. Store `all_tabs` in your browser state alongside `tabs`.
3. Return commands as before — the new action strings are just new enum variants.

```rust
// In your command enum / match:
match action.as_str() {
    "playPause"      => { /* existing */ }
    "next"           => { /* existing */ }
    "previous"       => { /* existing */ }
    "focusTab"       => { /* existing */ }
    "reactivateTab"  => { /* NEW — queue command, extension handles the rest */ }
    "reloadTab"      => { /* NEW */ }
    "closeTab"       => { /* NEW */ }
    _                => { /* ignore unknown */ }
}
```

---

### C. Frontend (Tauri webview / UI)

Split the browser tile into two sections:

#### Primary section — Media Tabs
Same as before. Additionally:
- Show `tabState` badge on each tile (💤 sleeping, ⚠️ crashed, ⏳ loading).
- If `tabState` is `"sleeping"` or `"crashed"`, show a **Reactivate** button
  that sends `{ tabId, action: "reactivateTab" }`.

#### Secondary section — All Other Tabs
A collapsible list (default collapsed). Each row shows:
- `favIconUrl` + `title` + abbreviated `url`
- `tabState` badge
- Action buttons:
  - **Focus**      → `focusTab`
  - **Reload**     → `reloadTab`
  - **Close**      → `closeTab`
  - **Reactivate** → `reactivateTab` (shown only for `sleeping` / `crashed`)

#### Idle detection (optional but recommended)
On media tab rows, if `userIdleMs > 300_000`:
- Show a faint "idle" indicator (e.g. grey dot or italic timestamp).
- This is purely visual; no command is needed.

---

### D. State Management

Add `all_tabs: Vec<TabMeta>` to whatever per-browser state struct you have.
Update it on every incoming payload. The field is replaced wholesale (same
pattern as `tabs`).

On browser disconnect (`connectionState === "disconnected"`):
- Clear both `tabs` and `all_tabs` for that browser.

---

### E. No Breaking Changes

- Old payloads without `allTabs` still parse correctly (`#[serde(default)]`).
- Old command actions still work — the extension handles them identically.
- The `/browser-media` endpoint URL and method are unchanged.

---

## File Inventory (extension)

| File            | Status   | Notes                                          |
|-----------------|----------|------------------------------------------------|
| `manifest.json` | Updated  | Version bumped to 1.1.0; added `"windows"` permission |
| `background.js` | Updated  | `allTabsMeta` map, new lifecycle listeners, new command handlers |
| `content.js`    | Updated  | Added `pageVisible`, `userIdleMs`, `documentState` to snapshot |

---

## Testing Checklist

- [ ] Extension loads without errors in chrome://extensions
- [ ] `POST /browser-media` body contains both `tabs` and `allTabs`
- [ ] `tabState` is `"sleeping"` for a tab that has been discarded (open many tabs to trigger, or use chrome://discards)
- [ ] `tabState` is `"crashed"` for a tab with a crashed renderer (navigate to `chrome://crash`)
- [ ] Sending `reactivateTab` reloads and focuses a discarded tab
- [ ] Sending `reloadTab` causes the tab to navigate (media entry is cleared and re-detected)
- [ ] Sending `closeTab` removes the tab from both lists
- [ ] Media controls (playPause, next, previous) still work as before
- [ ] `focusTab` still works as before
- [ ] Disconnecting the desktop app transitions `connectionState` to `"disconnected"` after 3 failures
