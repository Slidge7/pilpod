/**
 * PilPod Background Service Worker
 * ----------------------------------
 * Responsibilities:
 *  1. Detect the browser name (Chrome, Brave, Opera, Arc, Edge, Vivaldi, Firefox, etc.)
 *  2. Maintain a clean Map of tabs that genuinely contain media.
 *  3. Push state to the desktop app at PUSH_INTERVAL_MS AND whenever state changes.
 *  4. Receive commands from the desktop app and forward them to the right tab.
 *  5. Handle tab lifecycle: removal, navigation, crashes — no ghost entries.
 *  6. Report connection health (connected / disconnected) back to the desktop.
 *
 * Protocol with desktop app (Rust/Tauri):
 *  POST /browser-media
 *    Body:  { browserId, browserName, tabs: TabRow[] }
 *    Reply: { commands: [{ tabId, action }] }
 *
 * Connection health:
 *  - If 3 consecutive POSTs fail → set connectionState = "disconnected"
 *  - On the next successful POST    → set connectionState = "connected"
 *  - Desktop app should use connectionState to show/hide the browser tile.
 */

"use strict";

// ─── Config ──────────────────────────────────────────────────────────────────

const PUSH_URL          = "http://127.0.0.1:17399/browser-media";
const PUSH_INTERVAL_MS  = 250;   // periodic heartbeat + command polling
const DEBOUNCE_MS       = 60;    // fast push on snapshot change
const FAIL_THRESHOLD    = 3;     // consecutive failures before "disconnected"

// ─── State ───────────────────────────────────────────────────────────────────

/** @type {Map<number, import("./types").TabRow>} tabId → row */
const byTab = new Map();

/** Stable UUID for this browser profile, persisted across sessions. */
let browserId = "";

/** Human-readable browser name sent to desktop. */
let browserName = detectBrowserName();

/** Number of consecutive failed POSTs. */
let failCount = 0;

/** Last known connection state — sent in every payload so Rust can react. */
let connectionState = "connected";

/** Debounce timer handle. */
let debounceTimer = null;

// ─── Browser Detection ───────────────────────────────────────────────────────

/**
 * Detects browser name from the user-agent string and available APIs.
 * Returns one of: "Brave", "Opera", "Arc", "Edge", "Vivaldi", "Firefox",
 *                 "Chrome", "Chromium", "Safari", "Unknown".
 *
 * Note: user-agent sniffing is the only reliable option in a service worker
 * (no DOM, no window.navigator.brave, etc.).  Arc currently identifies as
 * Chrome on macOS, so we check for the Arc-specific UA hint if possible.
 */
function detectBrowserName() {
  const ua = (self.navigator?.userAgent || "").toLowerCase();

  // Brave: exposes navigator.brave (only in page context, not SW), but its UA
  // contains "chrome" without "brave".  We use the brands hint API if available.
  const brands = self.navigator?.userAgentData?.brands || [];
  const brandNames = brands.map((b) => b.brand.toLowerCase());

  if (brandNames.some((b) => b.includes("brave")))   return "Brave";
  if (brandNames.some((b) => b.includes("opera")))   return "Opera";
  if (brandNames.some((b) => b.includes("vivaldi"))) return "Vivaldi";
  if (brandNames.some((b) => b.includes("edge")))    return "Edge";

  // UA fallbacks
  if (ua.includes("opr/") || ua.includes("opera/")) return "Opera";
  if (ua.includes("vivaldi"))                        return "Vivaldi";
  if (ua.includes("edg/"))                           return "Edge";
  if (ua.includes("arc/"))                           return "Arc";
  if (ua.includes("firefox"))                        return "Firefox";
  if (ua.includes("chromium"))                       return "Chromium";
  if (ua.includes("chrome"))                         return "Chrome";
  if (ua.includes("safari"))                         return "Safari";

  return "Unknown";
}

// ─── Init: load/create persisted browserId ───────────────────────────────────

chrome.storage.local.get(["pilpodBrowserId"], (result) => {
  if (result?.pilpodBrowserId) {
    browserId = result.pilpodBrowserId;
  } else {
    browserId = crypto.randomUUID();
    chrome.storage.local.set({ pilpodBrowserId: browserId });
  }
});

// ─── Tab Snapshot Receiver ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "PILPOD_MEDIA_SNAPSHOT") return;
  const tabId = sender?.tab?.id;
  if (tabId == null) return;

  const p = msg.payload || {};

  if (!p.hasSignal) {
    // Content script explicitly says: no media on this tab.
    if (byTab.has(tabId)) {
      byTab.delete(tabId);
      schedulePush();
    }
    return;
  }

  const row = {
    tabId,
    browserId,
    url:           String(p.url           || ""),
    title:         String(p.title         || ""),
    artist:        String(p.artist        || ""),
    album:         String(p.album         || ""),
    playbackState: String(p.playbackState || "none"),
    artworkUrl:    String(p.artworkUrl    || ""),
    duration:      Number(p.duration      || 0),
    currentTime:   Number(p.currentTime   || 0),
  };

  const prev = byTab.get(tabId);
  const changed = !prev ||
    prev.playbackState !== row.playbackState ||
    prev.title         !== row.title         ||
    prev.currentTime   !== row.currentTime;

  byTab.set(tabId, row);

  if (changed) schedulePush();
});

// ─── Push Logic ──────────────────────────────────────────────────────────────

function schedulePush() {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void push();
  }, DEBOUNCE_MS);
}

async function push() {
  if (!browserId) return; // not yet initialised

  const tabs = Array.from(byTab.values());
  const payload = {
    browserId,
    browserName,
    connectionState,
    tabs,
  };

  try {
    const res = await fetch(PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Short timeout so a silent desktop doesn't block the next cycle.
      signal: AbortSignal.timeout(800),
    });

    if (!res.ok) {
      _recordFailure();
      return;
    }

    // Connection (re)established
    if (failCount > 0 || connectionState !== "connected") {
      failCount = 0;
      connectionState = "connected";
    }

    let data;
    try { data = await res.json(); } catch (_) { return; }

    // Process commands sent by the desktop app
    const cmds = Array.isArray(data?.commands) ? data.commands : [];
    for (const c of cmds) {
      const tid    = c?.tabId;
      const action = String(c?.action || "");
      if (tid == null || !action) continue;

      // Make sure the tab still exists before acting on it
      if (!byTab.has(tid)) continue;

      // ── focusTab: handled entirely in background, no content script needed ──
      if (action === "focusTab") {
        await focusTab(tid);
        continue;
      }

      try {
        await chrome.tabs.sendMessage(tid, {
          type:   "PILPOD_MEDIA_CONTROL",
          action,
        });
      } catch (_) {
        // Tab was closed or content script unavailable — evict it
        byTab.delete(tid);
      }
    }
  } catch (_) {
    // Network error or timeout — desktop app not running
    _recordFailure();
  }
}

function _recordFailure() {
  failCount++;
  if (failCount >= FAIL_THRESHOLD && connectionState !== "disconnected") {
    connectionState = "disconnected";
  }
}

// ─── focusTab ─────────────────────────────────────────────────────────────────

/**
 * Brings the browser window containing the given tab to the foreground,
 * then activates that tab within the window.
 *
 * Works across all Chromium-based browsers (Chrome, Brave, Edge, Opera,
 * Vivaldi, Arc).  Firefox WebExtension API is identical.
 *
 * Steps:
 *  1. Query the tab to get its windowId.
 *  2. Focus the window  (chrome.windows.update → focused: true).
 *  3. Activate the tab  (chrome.tabs.update    → active: true).
 *
 * If the tab no longer exists (race condition) we evict it from byTab.
 */
async function focusTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_) {
    // Tab no longer exists
    byTab.delete(tabId);
    schedulePush();
    return;
  }

  const windowId = tab.windowId;

  try {
    // Restore minimized / maximized windows so "focus" is visible on screen.
    await chrome.windows.update(windowId, { focused: true, state: "normal" });
  } catch (_) {
    // ignore
  }

  try {
    // Prefer highlight: selects the tab and raises the window in one path.
    await chrome.tabs.highlight({
      windowId,
      tabs: [tab.index],
    });
  } catch (_) {
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch (_) {
      byTab.delete(tabId);
      schedulePush();
      return;
    }
  }

  try {
    // Second focus pass: helps when the OS ignored the first (e.g. delayed
    // command from desktop) and only switched the tab in the background.
    await chrome.windows.update(windowId, { focused: true });
  } catch (_) {
    // ignore
  }
}

// ─── Periodic Heartbeat (also polls for commands) ────────────────────────────

setInterval(push, PUSH_INTERVAL_MS);

// Initial push immediately on SW startup
void push();

// ─── Tab Lifecycle Management ────────────────────────────────────────────────

/**
 * Tab closed → always evict immediately.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (byTab.has(tabId)) {
    byTab.delete(tabId);
    schedulePush();
  }
});

/**
 * Tab navigated to a new URL → evict the old media state.
 * The content script on the new page will report fresh state within one tick.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && byTab.has(tabId)) {
    byTab.delete(tabId);
    schedulePush();
  }
});

/**
 * Tab replaced (e.g. prerendering swap, bfcache restore) → evict and let
 * the content script on the replacement tab rebuild state.
 */
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (byTab.has(removedTabId)) {
    const row = byTab.get(removedTabId);
    byTab.delete(removedTabId);
    // Transfer to new tab id so we don't lose the entry if content script
    // hasn't reported yet. It will be overwritten on the first real snapshot.
    byTab.set(addedTabId, { ...row, tabId: addedTabId });
    schedulePush();
  }
});

/**
 * Window closed → evict all tabs that belonged to that window.
 * chrome.tabs.onRemoved fires per-tab too, but this is a safety net.
 */
chrome.windows.onRemoved.addListener((windowId) => {
  // We don't store windowId in byTab, so query currently known tabs
  // and prune any that no longer exist.
  chrome.tabs.query({}, (liveTabs) => {
    const liveIds = new Set(liveTabs.map((t) => t.id));
    let changed = false;
    for (const tabId of byTab.keys()) {
      if (!liveIds.has(tabId)) {
        byTab.delete(tabId);
        changed = true;
      }
    }
    if (changed) schedulePush();
  });
});