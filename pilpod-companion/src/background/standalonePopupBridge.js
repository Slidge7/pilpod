/**
 * Standalone popup bridge — handles all popup actions when desktop app is absent.
 * Manages: audio dashboard, mute, volume boost, tab sleep, tab switching, search.
 */

"use strict";

export const MSG_STANDALONE = "PILPOD_STANDALONE";

/**
 * Volume nodes map: tabId -> { context, source, gain }
 * Note: These are per-tab audio contexts injected via scripting.
 */

export function registerStandalonePopupBridge() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== MSG_STANDALONE) return false;

    void handleMessage(msg.action, msg.payload ?? {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));

    return true; // keep channel open for async response
  });
}

async function handleMessage(action, payload) {
  switch (action) {

    case "GET_ALL_TABS": {
      const tabs = await chrome.tabs.query({});
      return {
        tabs: tabs.map(serializeTab),
      };
    }

    case "GET_AUDIO_TABS": {
      const tabs = await chrome.tabs.query({ audible: true });
      return { tabs: tabs.map(serializeTab) };
    }

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
      // chrome.tabs.discard suspends the tab to free memory
      try {
        await chrome.tabs.discard(tabId);
      } catch (e) {
        // Tab might be active or already discarded
        throw new Error(`Cannot sleep tab: ${e.message}`);
      }
      return { ok: true };
    }

    case "SET_VOLUME": {
      // Volume boost via Web Audio API injected into the tab
      const { tabId, volume } = payload; // volume: 0–6 (0-600%)
      const clampedVol = Math.max(0, Math.min(6, Number(volume)));

      await chrome.scripting.executeScript({
        target: { tabId },
        func: applyVolumeBoost,
        args: [clampedVol],
        world: "MAIN",
      });

      // Persist volume setting
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

    default:
      throw new Error(`Unknown standalone action: ${action}`);
  }
}

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

/**
 * Injected into page's MAIN world to apply volume boost via Web Audio API.
 * @param {number} gain  0.0 = silent … 1.0 = normal … 6.0 = 600%
 */
function applyVolumeBoost(gain) {
  // Attach to window to persist across multiple calls
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

  // Connect all media elements not yet connected
  const mediaEls = document.querySelectorAll("audio, video");
  for (const el of mediaEls) {
    if (state.connected.has(el)) continue;
    try {
      const src = state.context.createMediaElementSource(el);
      src.connect(state.gainNode);
      state.connected.add(el);
    } catch {
      // Already connected to another context — skip
    }
  }
}
