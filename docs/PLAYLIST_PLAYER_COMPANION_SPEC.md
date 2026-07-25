# Playlist Player — Companion Extension Spec (protocol v2 `nav` capability)

> **Audience:** the `pilpod-companion` repo. The desktop side of this feature is
> fully implemented in this repo (see `PROTOCOL.md` §1/§2 and
> `src-tauri/src/playlist_player/`). The companion must add the three items
> below and advertise `caps.nav:true` in `hello`. Until it does, the desktop app
> shows "Update the companion extension" and disables playlist playback for
> that browser — nothing breaks.

## What the feature does

The desktop app plays a saved playlist through **one dedicated browser tab**
("player tab"). The app opens that tab once, then drives every track change by
navigating the *same* tab to the next media URL. Track-end detection, ordering,
repeat/shuffle, and UI all live on the desktop side — the companion only needs
to (1) open a tab, (2) navigate a tab, (3) report the created tab's id.

## Required changes (3)

### 1. `hello` — advertise the capability

```jsonc
{ "t":"hello", …, "caps":{ "delta":true, "progress":true, "nav":true } }
```

Add `nav:true` only when handlers 2 and 3 are implemented.

### 2. Handle `open` (App → Client)

```jsonc
{ "t":"open", "id":"o-1", "url":"https://…", "newWindow":true }
```

- `newWindow:true` → `chrome.windows.create({ url, focused: true })`, then the
  created window's first tab is the player tab.
  `newWindow:false` → `chrome.tabs.create({ url, active: true })` + focus its window.
- **Must reply** with `opened` (Client → App), success or failure:

```jsonc
{ "t":"opened", "id":"o-1", "ok":true,  "tabId":123, "windowId":4, "error":null }
{ "t":"opened", "id":"o-1", "ok":false, "tabId":null, "windowId":null, "error":"windows.create: <msg>" }
```

- Echo the exact `id` from the `open` frame — the desktop correlates on it.
- The new tab must also enter the normal `TabRegistry` → `delta` sync flow
  (it will automatically, if `tabs.onCreated` feeds the registry).
- `open` is user-initiated (Play was just pressed): the created window MUST be
  focused — expected feedback, and it unlocks autoplay policies. `nav` (track
  changes) must NEVER steal focus.

### 3. Handle `nav` (App → Client)

```jsonc
{ "t":"nav", "id":"n-2", "tabId":123, "url":"https://…" }
```

- `chrome.tabs.update(tabId, { url })`. Do **not** activate the tab.
- No dedicated reply. The navigation shows up as a normal `delta` upsert.
- If `tabId` is unknown (tab was closed), an `ack {id, ok:false, error}` is
  welcome but optional — the desktop also detects the tab's disappearance from
  the tab stream and stops the playlist session.

## Constraints & notes

- **URL allowlist:** only `http:`/`https:` URLs will ever be sent (enforced
  desktop-side). Still cheap-validate and refuse anything else with
  `ok:false` / ack error.
- **Rate:** `nav` arrives at human/track-change cadence (seconds apart, with a
  desktop-side 1.5 s debounce). No batching needed.
- **Autoplay:** media autoplay in a background tab is subject to the browser's
  autoplay policy. Sites where the user has an engagement history (YouTube
  etc.) generally autoplay. No companion workaround is required for v1; the
  desktop UI exposes play/pause for the player tab as a fallback.
- **Mirror update:** add the two inbound tags (`open`, `nav`) and one outbound
  tag (`opened`) to `src/bridge/protocol/messages.js` and its round-trip test,
  same commit as `PROTOCOL.md` per the contract header.

## Desktop-side contract (for reference)

- The app sends `open` **once** per playlist session, then only `nav` frames.
- Frame ids: `open` ids look like `o-<n>`, `nav` ids like `n-<n>`.
- If `opened` never arrives, the desktop adopts the player tab by URL match
  from the tab stream after a timeout — but the reply is still required
  behavior, not optional.
- The desktop may send `cmd` frames (`playPause`, `seek`, `setTabVolume`,
  `closeTab`, …) targeting the player tab like any other tab. No special
  handling needed.
