# PilPod Companion — Privacy Policy

**Last updated:** May 25, 2026  
**Extension:** PilPod Companion (Manifest V3)  
**Publisher:** PilPod

## Summary

PilPod Companion is a **companion extension** for the **PilPod desktop application**. It sends browser tab and media playback information **only to PilPod running on your own computer** (`127.0.0.1`). It does **not** send data to PilPod servers, third parties, or the cloud.

## What data the extension accesses

### Browser tabs
- Tab URL, title, and favicon
- Whether the tab is active, audible, muted, or pinned
- Tab and window identifiers used locally by PilPod

### Media playback (on supported media sites only)
When you play media on supported sites (for example YouTube, Spotify, Netflix), the extension may read:
- Media title, artist, album, and artwork URL
- Playback state (playing / paused)
- Current time and duration
- Whether the page is visible and basic page activity signals

### Custom sites
Users may manually grant PilPod Companion access to custom domains via the extension popup. This data is stored locally on the user's machine in `chrome.storage.local` and is never transmitted to external cloud services.

### Stored locally in the extension
- A random **browser profile ID** (`browserId`) saved in `chrome.storage.local` so PilPod can identify this browser profile across sessions.
- **Custom site rules** (`pilpodConfig.customRules`) — domains you explicitly approved for content script injection.
- **Dismissed discovery suggestions** (`pilpodConfig.ignoredDomains`) — domains you chose not to add.

## What the extension does not collect

- No account login or personal identity
- No analytics or advertising data
- No keystrokes, passwords, or form input
- No data sent to remote servers
- No sale or sharing of user data with third parties

## Where data goes

All communication is **localhost only**:
- `http://127.0.0.1:17399`
- `ws://127.0.0.1:17400`

If the PilPod desktop app is not running, the extension cannot deliver data anywhere else.

## Why data is used

Data is used solely to:
- Show your open browser tabs and now-playing media inside the PilPod desktop app
- Let you control tabs and media playback from PilPod (focus tab, play/pause, next, close tab, etc.)

## Data retention

- The extension stores the local `browserId`, custom site rules, and dismissed domains in browser storage.
- Tab and media data is held in memory while the extension runs and is sent to the local PilPod app; PilPod desktop retention is governed by the PilPod application, not this extension.

## Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Persist browser profile ID and custom site configuration |
| `tabs` | Read tab metadata, audible state, and perform tab actions requested by PilPod |
| `windows` | Focus browser windows when switching tabs from PilPod |
| `scripting` | Register content scripts on user-approved custom domains |
| `activeTab` | Allow adding a custom site from the active tab without blanket host permissions at install |
| Optional host (`http://*/*`, `https://*/*`) | Runtime permission requests when you explicitly add a custom media site |
| Host: `127.0.0.1` | Communicate with the local PilPod desktop app only |

## Children

PilPod Companion is not directed at children under 13.

## Changes

We may update this policy if the extension behavior changes. The “Last updated” date above will be revised when that happens.

## Contact

For privacy questions about PilPod Companion, contact the PilPod project maintainers through the project repository or website listed on the Chrome Web Store listing.
