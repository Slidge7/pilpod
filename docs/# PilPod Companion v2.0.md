# PilPod Companion v2.0.0 — Implementation Plan

This is the definitive technical blueprint to refactor PilPod Companion. Feed this document directly to the implementation agent.

## 1. Executive Summary & CWS Strategy

**The Core Fix:** Transition from a blanket `<all_urls>` injection model to a **Hybrid Injection Architecture**.

* **Static Layer:** Hardcode worldwide media domains into `manifest.json` `content_scripts`. This covers 95% of use cases out of the box and passes CWS automated checks because the domains match the declared purpose.
* **Dynamic Layer:** Use `chrome.scripting.registerContentScripts` paired with runtime host permission requests (`chrome.permissions.request`) for user-added domains.
* **Discovery Heuristic:** To detect unknown media sites without injecting code, the background script will monitor `chrome.tabs.onUpdated` for the `audible: true` flag. If an unknown tab becomes audible, the extension badge updates, prompting the user to explicitly grant host permissions via the new UI.

## 2. Phase Breakdown

* **Phase 1: Manifest & Static Allowlist Refactor.** Update `manifest.json`, strip `<all_urls>`, implement the static media URL list (including iframe support via `all_frames: true`), and verify the PilPod desktop sync remains stable.
* **Phase 2: Data Models & Dynamic Scripting.** Implement `chrome.storage` schemas for custom user rules and wire up `chrome.scripting.registerContentScripts`.
* **Phase 3: UI & Discovery Engine.** Build the HTML/CSS/JS for the popup UI. Implement the `audible` detection heuristic in `background.js` to trigger "Add this site" prompts.
* **Phase 4: Security & CWS Packaging.** Hardcode the `127.0.0.1` WebSocket validation, remove unneeded background listeners, and compile the final ZIP, Privacy Policy, and CWS reviewer notes.

## 3. Manifest & Permissions Final State

```json
{
  "manifest_version": 3,
  "name": "PilPod Companion",
  "version": "2.0.0",
  "description": "Bridge between browser media tabs and the PilPod desktop app. Tracks tab states and syncs media controls securely via localhost.",
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" },
  "permissions": [
    "storage",
    "tabs",
    "windows",
    "alarms",
    "scripting",
    "activeTab"
  ],
  "host_permissions": [
    "http://127.0.0.1:17399/*",
    "ws://127.0.0.1:17400/*"
  ],
  "background": {
    "service_worker": "src/background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "src/ui/popup.html",
    "default_icon": "icons/48.png"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*;"
  },
  "content_scripts": [
    {
      "matches": [
        "*://*.youtube.com/*", "*://*.youtube-nocookie.com/*", "*://youtu.be/*", "*://music.youtube.com/*",
        "*://*.netflix.com/*", "*://*.vimeo.com/*", "*://*.twitch.tv/*", "*://player.twitch.tv/*",
        "*://*.http://googleusercontent.com/spotify.com/7", "*://*.soundcloud.com/*", "*://*.deezer.com/*", "*://listen.tidal.com/*",
        "*://*.bandcamp.com/*", "*://*.primevideo.com/*", "*://*.amazon.com/gp/video/*",
        "*://*.disneyplus.com/*", "*://*.hulu.com/*", "*://*.max.com/*", "*://*.crunchyroll.com/*",
        "*://*.dailymotion.com/*", "*://*.bilibili.com/*", "*://*.iqiyi.com/*", "*://*.shahid.mbc.net/*",
        "*://*.kick.com/*", "*://*.dazn.com/*", "*://*.espn.com/*", "*://*.plus.rtl.de/*",
        "*://*.joyn.de/*", "*://*.bbc.co.uk/iplayer/*", "*://globoplay.globo.com/*", "*://*.hotstar.com/*"
      ],
      "js": ["dist/content.js"],
      "run_at": "document_start",
      "all_frames": true,
      "match_about_blank": true,
      "match_origin_as_fallback": true
    }
  ]
}

```

*Permissions Justification for CWS:*

* `tabs`: Read tab URLs, titles, and `audible` state for desktop sync.
* `windows`: Focus browser windows when commanded by desktop.
* `scripting`: Dynamically inject the content script *only* into user-approved custom domains.
* `activeTab`: Allows adding a custom site without needing blanket host permissions upfront.

## 4. Content Script Injection Strategy

### Static List (Built-in)

The manifest `content_scripts` array explicitly defines the worldwide media sites.
**Iframe Strategy:** Setting `all_frames: true` and `match_origin_as_fallback: true` on these specific domains guarantees that if a non-media site (e.g., `nytimes.com`) embeds a YouTube or Vimeo player, the content script injects *only* inside the iframe sandbox of the media provider. It does not touch the parent DOM.

### Dynamic List (User-Added)

1. **Discovery:** `background.js` listens to `chrome.tabs.onUpdated`. If `tab.audible === true` AND the URL is not in the static/dynamic lists, trigger `chrome.action.setBadgeText({text: "+", tabId})`.
2. **Consent:** User clicks the extension popup. UI shows "Media detected on [domain]. Add to PilPod?"
3. **Elevation:** User clicks "Add". The UI calls `chrome.permissions.request({ origins: ["*://*.domain.com/*"] })`.
4. **Registration:** On success, `background.js` adds the domain to Chrome storage and calls `chrome.scripting.registerContentScripts` to persist the injection rule.

## 5. Data Models (Storage Schema)

Use `chrome.storage.local` to manage state.

```typescript
// Key: "pilpodConfig"
interface PilPodConfig {
  browserId: string;
  customRules: CustomRule[];
  ignoredDomains: string[]; // Domains the user explicitly dismissed from suggestions
}

interface CustomRule {
  id: string;          // e.g., "rule_1715421"
  domain: string;      // e.g., "mycustomplayer.com"
  enabled: boolean;
  dateAdded: number;
}

```

## 6. UI Spec (Popup)

**File:** `src/ui/popup.html` / `src/ui/popup.js`
Minimal tabbed interface or single-column flexbox.

* **Header:** PilPod logo + Connection Status indicator (Green dot = Desktop Connected, Red = Disconnected).
* **Active Context (Dynamic):**
* *If on an active media tab:* Shows "Tracking: [Title]".
* *If on an unknown audible tab:* Shows prominent "Add [domain] to PilPod" button.


* **Rules Manager Section:** List of `customRules`. Toggle switch for `enabled/disabled`. Trash can icon to delete. "Manually add domain" text input.

## 7. Module / File Changes

* **`manifest.json`:** Overwrite with Phase 3 JSON.
* **`src/ui/` (NEW):** Create `popup.html`, `popup.css`, `popup.js`.
* **`src/shared/mediaUrlRules.js`:** Delete. The static list now lives entirely in the manifest. Remove gatekeeping logic from the background script; if the content script sends a message, it is implicitly on an allowed site.
* **`src/background/tabs/lifecycle.js`:** Add `tab.audible` tracking. Send badge updates for discovery logic.
* **`src/background/dynamicInjection.js` (NEW):** Wrap `chrome.scripting` API calls to sync `chrome.storage.local.customRules` with the browser's registered scripts.
* **`src/background/transport/wsTransport.js`:** Hardcode connection URL validation to strictly `ws://127.0.0.1:*`. Drop the override capability to satisfy CWS security policies.

## 8. CWS Submission Package

**Reviewer Notes (Copy & Paste):**

> "PilPod Companion is a local bridge for the PilPod desktop application. It uses a hybrid injection model. The manifest statically injects into known media platforms (YouTube, Netflix, etc.) to sync media state (play/pause/title) to the user's local desktop via WebSocket (ws://127.0.0.1). It does not use <all_urls>. For custom media sites, the extension uses the 'scripting' and 'activeTab' permissions to allow users to manually grant host access to specific domains via the popup UI. No data is sent to external cloud servers; all telemetry is strictly local."

**Privacy Policy Updates:**
Add a "Custom Sites" section stating: *“Users may manually grant PilPod Companion access to custom domains. This data is stored locally on the user's machine and is never transmitted to external cloud services.”*

## 9. Risk Register

* **Risk:** `chrome.scripting.registerContentScripts` failing on update.
* **Mitigation:** Wipe and re-register all custom scripts on extension initialization/update in `background.js` using `chrome.scripting.getRegisteredContentScripts`.


* **Risk:** CWS rejects due to "broad host permissions" if users add too many sites.
* **Mitigation:** `chrome.permissions.request` places the burden of consent on the user. CWS permits this as it is explicit opt-in.


* **Risk:** Desktop protocol mismatch.
* **Mitigation:** `TabPost` payload remains identical. Media `null` state is preserved for standard tab mirroring.



## 10. Test Plan

1. **Static List:** Open YouTube. Verify `dist/content.js` injects. Verify PilPod desktop receives WebSocket payload.
2. **Iframe Bypass:** Open a non-media site (e.g., a news blog) with an embedded YouTube player. Verify PilPod detects the video inside the iframe without injecting into the parent blog DOM.
3. **Discovery & activeTab:** Open an unknown media site (e.g., `random-audio.com`). Play audio. Verify extension badge turns to "+". Click popup, click "Add". Verify page reloads/injects and media syncs.
4. **Localhost Security:** Attempt to spoof the `/capabilities` endpoint to return an external `ws://evil.com`. Verify `wsTransport.js` rejects the connection.

## 11. Protocol / Desktop Impact

**Zero changes required to PilPod Desktop Rust code.** The extension's output shape (`TabPost`) and WebSocket message schemas remain exactly the same as v1.3.0.

## 12. Migration

Add an initialization listener in `background.js`:

```javascript
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "update" && details.previousVersion.startsWith("1.")) {
    // Initialize v2 schema
    chrome.storage.local.set({
      pilpodConfig: {
        browserId: await getExistingBrowserId(),
        customRules: [],
        ignoredDomains: []
      }
    });
  }
});

```