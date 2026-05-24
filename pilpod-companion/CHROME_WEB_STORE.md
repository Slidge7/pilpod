# PilPod Companion — Chrome Web Store submission notes

Use this document when filling out the Chrome Web Store listing and the **notes for reviewers** field.

## Privacy policy URL

Host `PRIVACY.md` at a public URL and paste it into the store listing.

Example (update to your real URL before submission):

```
https://github.com/pilpod/pilpod/blob/main/pilpod-companion/PRIVACY.md
```

## Short description (132 chars max)

```
Companion for the PilPod desktop app. Syncs tabs and media playback to localhost only. Requires PilPod installed and running.
```

## Detailed description

```
PilPod Companion connects your browser to the PilPod desktop app on the same computer.

What it does:
• Shows your open browser tabs inside PilPod
• Detects now-playing media on supported sites (YouTube, Spotify, Netflix, Twitch, and others)
• Lets PilPod control playback and tabs (play/pause, next, focus tab, close tab)

Requirements:
• PilPod desktop app must be installed and running on this machine
• Works only over localhost (127.0.0.1) — no cloud, no remote servers

Privacy:
• Tab and media data is sent only to the PilPod app on your computer
• No analytics, no third-party data sharing
• See the linked privacy policy for full details
```

## Single purpose

```
This extension exists solely as the browser bridge for the PilPod desktop media dashboard application.
```

## Permission justifications (Developer Dashboard)

**tabs** — Read open tab metadata (URL, title, audible state) and perform tab actions when the user controls media from the PilPod desktop app.

**storage** — Store a stable local browser profile ID so PilPod can identify this browser installation across sessions.

**windows** — Focus the correct browser window when the user selects a tab from PilPod.

**Host permission: http://127.0.0.1:17399/\*, http://127.0.0.1:17400/\*** — Communicate exclusively with the PilPod desktop app running on the user's machine. No external network access.

## Notes for reviewers — testing instructions

Copy the block below into the **Notes for reviewers** field:

```
PilPod Companion requires the PilPod desktop application running locally. It does not work standalone.

How to test:
1. Install and launch the PilPod desktop app (Windows installer or dev build).
2. Load this extension (unpacked or from the submitted package).
3. Confirm PilPod is listening on localhost:
   - http://127.0.0.1:17399/capabilities should respond while PilPod is running.
4. Open https://www.youtube.com/watch?v=dQw4w9WgXcQ (or any YouTube watch URL).
5. Press Play on the video.
6. In PilPod, verify a browser tab entry appears with playback state "playing".
7. From PilPod, trigger play/pause — the YouTube tab should pause/resume.
8. Close PilPod — the extension should stop updating; no data leaves localhost.

Data handling:
• All network traffic is to 127.0.0.1 only (HTTP + WebSocket).
• No remote servers, analytics, or accounts.
• Privacy policy: [INSERT YOUR PUBLIC PRIVACY POLICY URL]

Permissions:
• "scripting" was removed — content scripts are declared statically in manifest.json.
• "tabs" is required to mirror tab metadata to the local desktop app and to focus/reload/close tabs on user action from PilPod.
```

## Data use disclosure (Privacy practices tab)

When completing Chrome Web Store privacy certifications, declare:

| Data type | Collected | Purpose | Shared |
|-----------|-----------|---------|--------|
| Website content (media metadata on supported sites) | Yes | App functionality | No |
| Web history / URLs (open tab URLs) | Yes | App functionality | No |
| User activity (playback state, tab active/audible) | Yes | App functionality | No |

**Data is not sold.**  
**Data is not used for advertising.**  
**Data is not transferred to third parties** — only to the local PilPod desktop app on the same machine.

## Package checklist before upload

```powershell
cd pilpod-companion
npm run package
```

The zip must include:
- `manifest.json`
- `icons/`
- `dist/content.js`
- `src/background.js`, `src/background/`, `src/shared/`

## Store assets still needed outside the repo

- At least one screenshot (1280×800 or 640×400) showing PilPod with a browser tab detected
- Promotional tile images if required by the dashboard
- Public privacy policy URL (host `PRIVACY.md`)
