/** @typedef {{ tabId: number, browserId: string, url: string, title: string, artist: string, album: string, playbackState: string }} TabRow */

const PUSH_URL = "http://127.0.0.1:17399/browser-media";

/** How often we POST tab state and pick up play/pause/etc. commands from the desktop (ms). */
const PUSH_INTERVAL_MS = 200;

/** @type {Map<number, TabRow>} */
const byTab = new Map();

/** Stable UUID for this browser profile — generated once, persisted in storage. */
let browserId = "";

/** Debounced push when a tab sends a snapshot — snappier metadata without one POST per event. */
let pushDebounceTimer = 0;
function schedulePushSoon() {
  if (pushDebounceTimer) return;
  pushDebounceTimer = setTimeout(() => {
    pushDebounceTimer = 0;
    void push();
  }, 50);
}

chrome.storage.local.get(["omniBrowserId"], (result) => {
  if (result.omniBrowserId) {
    browserId = result.omniBrowserId;
  } else {
    browserId = crypto.randomUUID();
    chrome.storage.local.set({ omniBrowserId: browserId });
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "OMNI_MEDIA_SNAPSHOT" || sender.tab == null) return;
  const id = sender.tab.id;
  if (id == null) return;

  const p = msg.payload || {};
  const title = String(p.title || "");
  const artist = String(p.artist || "");
  const album = String(p.album || "");
  const playbackState = String(p.playbackState || "none");
  const url = String(p.url || "");

  const hasSignal =
    playbackState === "playing" ||
    playbackState === "paused" ||
    title.length > 0 ||
    artist.length > 0 ||
    album.length > 0;

  if (!hasSignal) {
    byTab.delete(id);
    schedulePushSoon();
    return;
  }

  byTab.set(id, {
    tabId: id,
    browserId,
    url,
    title,
    artist,
    album,
    playbackState,
  });
  schedulePushSoon();
});

async function push() {
  if (!browserId) return; // not yet initialised
  const tabs = Array.from(byTab.values());
  try {
    const res = await fetch(PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Top-level browserId tells the app which browser slot to update
      body: JSON.stringify({ browserId, tabs }),
    });
    if (!res.ok) return;
    let data;
    try {
      data = await res.json();
    } catch (_) {
      return;
    }
    const cmds = data && Array.isArray(data.commands) ? data.commands : [];
    for (const c of cmds) {
      const tid = c.tabId;
      const action = c.action;
      if (tid == null || !action) continue;
      try {
        await chrome.tabs.sendMessage(tid, {
          type: "OMNI_MEDIA_CONTROL",
          action: String(action),
        });
      } catch (_) {
        /* tab closed or no content script on this URL */
      }
    }
  } catch (_) {
    /* app not running or port blocked */
  }
}

void push();
setInterval(push, PUSH_INTERVAL_MS);

chrome.tabs.onRemoved.addListener((tabId) => {
  byTab.delete(tabId);
});
