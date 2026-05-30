/**
 * Standalone popup bridge — handles all popup actions when desktop app is absent.
 * Feature-01: Media Controller (seek, skip ad, playlist nav, PiP, mute/pause all, volume reset)
 */

"use strict";

export const MSG_STANDALONE = "PILPOD_STANDALONE";

export function registerStandalonePopupBridge() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== MSG_STANDALONE) return false;

    void handleMessage(msg.action, msg.payload ?? {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));

    return true;
  });
}

// ─── Ad watcher state ─────────────────────────────────────────────────────────
// tabId -> alarmName
const adWatcherTabs = new Set();

// ─── Router ───────────────────────────────────────────────────────────────────

async function handleMessage(action, payload) {
  switch (action) {

    // ── Tab queries ───────────────────────────────────────────────────────────

    case "GET_ALL_TABS": {
      const tabs = await chrome.tabs.query({});
      return { tabs: tabs.map(serializeTab) };
    }

    case "GET_AUDIO_TABS": {
      const tabs = await chrome.tabs.query({ audible: true });
      return { tabs: tabs.map(serializeTab) };
    }

    // ── Tab controls ──────────────────────────────────────────────────────────

    case "MUTE_TAB": {
      const { tabId, muted } = payload;
      await chrome.tabs.update(tabId, { muted: Boolean(muted) });
      const tab = await chrome.tabs.get(tabId);
      return { tab: serializeTab(tab) };
    }

    case "FOCUS_TAB": {
      const { tabId } = payload;
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      return { ok: true };
    }

    case "SLEEP_TAB": {
      const { tabId } = payload;
      try {
        await chrome.tabs.discard(tabId);
      } catch (e) {
        throw new Error(`Cannot sleep tab: ${e.message}`);
      }
      return { ok: true };
    }

    // ── Volume (Web Audio GainNode injection) ──────────────────────────────────

    case "SET_VOLUME": {
      const { tabId, volume } = payload;
      const clampedVol = Math.max(0, Math.min(6, Number(volume)));

      await chrome.scripting.executeScript({
        target: { tabId },
        func: injected_applyVolumeBoost,
        args: [clampedVol],
        world: "MAIN",
      });

      const stored = await chrome.storage.session.get(["pilpod_volumes"]);
      const volumes = stored.pilpod_volumes ?? {};
      volumes[tabId] = clampedVol;
      await chrome.storage.session.set({ pilpod_volumes: volumes });

      return { volume: clampedVol };
    }

    case "GET_VOLUMES": {
      const stored = await chrome.storage.session.get(["pilpod_volumes"]);
      return { volumes: stored.pilpod_volumes ?? {} };
    }

    // ── Feature-01: Global volume reset ───────────────────────────────────────

    case "RESET_ALL_VOLUMES": {
      // Drop every GainNode back to 1.0 in all tabs
      const tabs = await chrome.tabs.query({});
      const results = await Promise.allSettled(
        tabs.map(tab =>
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: injected_applyVolumeBoost,
            args: [1.0],
            world: "MAIN",
          }).catch(() => null)
        )
      );

      // Clear persisted volumes
      await chrome.storage.session.set({ pilpod_volumes: {} });

      const resetCount = results.filter(r => r.status === "fulfilled").length;
      return { resetCount };
    }

    // ── Feature-01: Mute all tabs ─────────────────────────────────────────────

    case "MUTE_ALL_TABS": {
      const { muted } = payload; // true = mute, false = unmute
      const tabs = await chrome.tabs.query({ audible: true });
      await Promise.allSettled(
        tabs.map(t => chrome.tabs.update(t.id, { muted: Boolean(muted) }))
      );
      return { count: tabs.length };
    }

    // ── Feature-01: Pause all tabs ────────────────────────────────────────────

    case "PAUSE_ALL_TABS": {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(
        tabs.map(tab =>
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: injected_pauseAllMedia,
            world: "MAIN",
          }).catch(() => null)
        )
      );
      return { ok: true };
    }

    // ── Feature-01: Get current tab media state (for seekbar) ─────────────────

    case "GET_MEDIA_STATE": {
      const { tabId } = payload;
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: injected_getMediaState,
        world: "MAIN",
      });
      const state = results?.[0]?.result ?? null;
      return { state };
    }

    // ── Feature-01: Seek (set currentTime) ───────────────────────────────────

    case "SEEK_MEDIA": {
      const { tabId, time } = payload;
      await chrome.scripting.executeScript({
        target: { tabId },
        func: injected_seekMedia,
        args: [time],
        world: "MAIN",
      });
      return { ok: true };
    }

    // ── Feature-01: Skip ad ───────────────────────────────────────────────────

    case "GET_AD_STATE": {
      // Returns: { adPlaying, skippable, countdown, method }
      const { tabId } = payload;
      let results;
      try {
        results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: injected_getAdState,
          world: "MAIN",
        });
      } catch {
        return { adPlaying: false, skippable: false, countdown: null };
      }
      // Merge results across all frames — any frame that sees an ad wins
      const hit = (results ?? []).map(r => r.result).find(r => r?.adPlaying);
      return hit ?? { adPlaying: false, skippable: false, countdown: null };
    }

    case "SKIP_AD": {
      const { tabId } = payload;
      let results;
      try {
        results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: injected_skipAd,
          world: "MAIN",
        });
      } catch (e) {
        throw new Error(`Script injection failed: ${e.message}`);
      }
      // Any frame that managed to skip counts
      const skipped = (results ?? []).some(r => r.result === true);
      return { skipped };
    }

    // ── Feature-01: PiP toggle ────────────────────────────────────────────────

    case "PIP_TOGGLE": {
      const { tabId } = payload;
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: injected_togglePiP,
        world: "MAIN",
      });
      const state = results?.[0]?.result ?? "unknown";
      return { state };
    }

    // ── Feature-01: Playlist navigation ──────────────────────────────────────

    case "PLAYLIST_NEXT": {
      const { tabId } = payload;
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: injected_playlistNav,
        args: ["next"],
        world: "MAIN",
      });
      return { clicked: results?.[0]?.result ?? false };
    }

    case "PLAYLIST_PREV": {
      const { tabId } = payload;
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: injected_playlistNav,
        args: ["prev"],
        world: "MAIN",
      });
      return { clicked: results?.[0]?.result ?? false };
    }

    default:
      throw new Error(`Unknown standalone action: ${action}`);
  }
}

// ─── Serialise tab ────────────────────────────────────────────────────────────

function serializeTab(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title ?? "",
    url: tab.url ?? "",
    favIconUrl: tab.favIconUrl ?? "",
    audible: tab.audible ?? false,
    mutedInfo: tab.mutedInfo ?? { muted: false },
    active: tab.active ?? false,
    status: tab.status ?? "complete",
    discarded: tab.discarded ?? false,
    index: tab.index,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  INJECTED FUNCTIONS (run inside page's MAIN world)
//  Must be self-contained — no closures over outer scope.
// ─────────────────────────────────────────────────────────────────────────────

/** Apply Web Audio GainNode boost to all media elements */
function injected_applyVolumeBoost(gain) {
  if (!window.__pilpodAudio) {
    window.__pilpodAudio = { context: null, gainNode: null, connected: new WeakSet() };
  }
  const state = window.__pilpodAudio;

  if (!state.context) {
    state.context = new AudioContext();
    state.gainNode = state.context.createGain();
    state.gainNode.connect(state.context.destination);
  }

  state.gainNode.gain.value = gain;

  const mediaEls = document.querySelectorAll("audio, video");
  for (const el of mediaEls) {
    if (state.connected.has(el)) continue;
    try {
      const src = state.context.createMediaElementSource(el);
      src.connect(state.gainNode);
      state.connected.add(el);
    } catch { /* already captured */ }
  }
}

/** Pause every <audio> and <video> element in the page */
function injected_pauseAllMedia() {
  const els = document.querySelectorAll("audio, video");
  for (const el of els) {
    try { if (!el.paused) el.pause(); } catch { /* cross-origin iframe */ }
  }
}

/** Return state of the primary video element */
function injected_getMediaState() {
  // Prefer a playing element, fall back to first found
  const all = [...document.querySelectorAll("video, audio")];
  if (!all.length) return null;

  const el = all.find(e => !e.paused) ?? all[0];
  return {
    currentTime: el.currentTime,
    duration: isFinite(el.duration) ? el.duration : 0,
    paused: el.paused,
    muted: el.muted,
    volume: el.volume,
    type: el.tagName.toLowerCase(),
    src: el.currentSrc || el.src || "",
    readyState: el.readyState,
  };
}

/** Seek primary media element to given time */
function injected_seekMedia(time) {
  const all = [...document.querySelectorAll("video, audio")];
  const el = all.find(e => !e.paused) ?? all[0];
  if (!el) return false;
  try {
    el.currentTime = time;
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect ad state in this frame.
 * Returns { adPlaying, skippable, countdown, method }
 */
function injected_getAdState() {
  // ── YouTube skip button visible = skippable ──────────────────────────────
  const ytSkipBtn = document.querySelector(
    ".ytp-skip-ad-button, .ytp-skip-ad-button__text, .videoAdUiSkipButton, [class*='ytp-skip']"
  );
  if (ytSkipBtn) {
    const style = window.getComputedStyle(ytSkipBtn);
    const visible = style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    if (visible) return { adPlaying: true, skippable: true, countdown: null, method: "yt-skip-btn" };
  }

  // ── YouTube countdown badge (ad playing but not skippable yet) ────────────
  const ytCountdown = document.querySelector(
    ".ytp-ad-skip-button-slot, .ytp-ad-skip-button-container, " +
    ".ytp-skip-ad-button[style*='display: none'], " +
    ".ytp-ad-preview-container, .ytp-ad-preview-slot"
  );
  const ytAdText = document.querySelector(
    ".ytp-ad-text, .ytp-ad-simple-ad-badge, .ytp-ad-badge, " +
    ".ad-showing .ytp-progress-bar"
  );
  // Check for .ad-showing class on the player (YouTube adds this during ads)
  const playerEl = document.querySelector(".ad-showing, .html5-video-player.ad-showing");

  if (playerEl || ytAdText) {
    // Try to find countdown number
    const skipCountEl = document.querySelector(
      ".ytp-ad-skip-button-slot .ytp-ad-skip-button-text, " +
      ".ytp-skip-ad-button .ytp-skip-ad-button__text, " +
      "[class*='countdown']"
    );
    const countdown = skipCountEl ? skipCountEl.textContent.trim() : null;
    return { adPlaying: true, skippable: false, countdown, method: "yt-ad-showing" };
  }

  // ── Generic: look for visible skip/close buttons ──────────────────────────
  const genericSelectors = [
    "[class*='skip-ad']", "[class*='skipAd']", "[class*='skip_ad']",
    "[id*='skip-ad']",   "[id*='skipAd']",
    "[class*='ad-skip']", "[class*='adSkip']",
    "[class*='SkipAd']",
  ];
  for (const sel of genericSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const st = window.getComputedStyle(el);
      if (st.display !== "none" && st.visibility !== "hidden") {
        return { adPlaying: true, skippable: true, countdown: null, method: "generic-selector" };
      }
    }
  }

  // ── Generic text button scan ──────────────────────────────────────────────
  const allInteractive = [...document.querySelectorAll("button, [role='button'], a")];
  const skipTextBtn = allInteractive.find(el => {
    const t = (el.textContent || "").trim().toLowerCase();
    return ["skip", "skip ad", "skip ads", "close ad", "skip advertisement"].includes(t);
  });
  if (skipTextBtn) {
    return { adPlaying: true, skippable: true, countdown: null, method: "text-btn" };
  }

  // ── Short video heuristic (possible pre-roll ad) ──────────────────────────
  const videos = [...document.querySelectorAll("video")];
  const possibleAd = videos.find(v =>
    !v.paused && isFinite(v.duration) && v.duration > 0 && v.duration <= 30
  );
  if (possibleAd) {
    return { adPlaying: true, skippable: true, countdown: null, method: "short-video" };
  }

  return { adPlaying: false, skippable: false, countdown: null, method: null };
}

/**
 * Smart ad skipper — run across all frames via allFrames:true.
 * Returns true if this frame successfully triggered a skip.
 */
function injected_skipAd() {
  // Strategy 1: known skip button selectors — click if visible
  const skipSelectors = [
    ".ytp-skip-ad-button",
    ".ytp-skip-ad-button__text",
    ".videoAdUiSkipButton",
    "[class*='skip-ad']",
    "[class*='skipAd']",
    "[class*='skip_ad']",
    "[id*='skip-ad']",
    "[id*='skipAd']",
    "[class*='SkipAd']",
    "[class*='ad-skip']",
  ];

  for (const sel of skipSelectors) {
    const btn = document.querySelector(sel);
    if (!btn) continue;
    const st = window.getComputedStyle(btn);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") continue;
    btn.click();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }

  // Strategy 2: text-based skip buttons
  const allBtns = [...document.querySelectorAll("button, [role='button'], a")];
  const textMatch = allBtns.find(el => {
    const t = (el.textContent || "").trim().toLowerCase();
    return ["skip", "skip ad", "skip ads", "close ad", "skip advertisement"].includes(t);
  });
  if (textMatch) {
    textMatch.click();
    return true;
  }

  // Strategy 3: fast-forward video to end (handles any video duration)
  const videos = [...document.querySelectorAll("video")];
  const adVid = videos.find(v =>
    !v.paused && isFinite(v.duration) && v.duration > 0
  );
  if (adVid) {
    adVid.muted = true;
    adVid.currentTime = adVid.duration;
    return true;
  }

  return false;
}
/**
 * Toggle Picture-in-Picture for the primary video element.
 * Returns "entered" | "exited" | "unsupported"
 */
async function injected_togglePiP() {
  if (!document.pictureInPictureEnabled) return "unsupported";

  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return "exited";
  }

  const videos = [...document.querySelectorAll("video")];
  const target = videos.find(v => !v.paused) ?? videos[0];
  if (!target) return "unsupported";

  try {
    await target.requestPictureInPicture();
    return "entered";
  } catch (e) {
    return `error:${e.message}`;
  }
}

/**
 * Playlist navigation — tries platform-specific then generic selectors.
 * direction: "next" | "prev"
 */
function injected_playlistNav(direction) {
  const isNext = direction === "next";

  // YouTube
  const ytNext = document.querySelector(".ytp-next-button");
  const ytPrev = document.querySelector(".ytp-prev-button");
  if (isNext && ytNext) { ytNext.click(); return true; }
  if (!isNext && ytPrev) { ytPrev.click(); return true; }

  // Spotify Web
  const spNext = document.querySelector("[data-testid='control-button-skip-forward']");
  const spPrev = document.querySelector("[data-testid='control-button-skip-back']");
  if (isNext && spNext) { spNext.click(); return true; }
  if (!isNext && spPrev) { spPrev.click(); return true; }

  // SoundCloud
  const scNext = document.querySelector(".skipControl__next");
  const scPrev = document.querySelector(".skipControl__previous");
  if (isNext && scNext) { scNext.click(); return true; }
  if (!isNext && scPrev) { scPrev.click(); return true; }

  // Generic aria/title attributes
  const all = [...document.querySelectorAll("button, [role='button']")];

  const nextKeywords = ["next", "next track", "next song", "forward", "skip forward"];
  const prevKeywords = ["previous", "prev", "back", "last track", "skip back"];
  const keywords = isNext ? nextKeywords : prevKeywords;

  const match = all.find(el => {
    const label = (el.getAttribute("aria-label") || el.title || el.textContent || "").trim().toLowerCase();
    return keywords.some(k => label.includes(k));
  });

  if (match) { match.click(); return true; }
  return false;
}

