/**
 * PilPod standalone popup
 * Feature-01: Seekbar · Skip Ad · Playlist Nav · PiP · Mute All · Pause All · Reset Volumes
 */

"use strict";

const MSG = "PILPOD_STANDALONE";

// ─── State ────────────────────────────────────────────────────────────────────

let allTabs          = [];
let volumes          = {};       // tabId -> gain (0-6)
let currentView      = "audio";  // "audio" | "all" | "controls"
let searchQuery      = "";
let expandedTabId    = null;
let volumePanelTabId = null;

// Controls panel state
let mediaState       = null;     // current active-tab media info
let adState          = null;     // current active-tab ad info
let seekPollerTimer  = null;     // setInterval handle
let adPollerTimer    = null;     // ad detection interval
let muteAllActive    = false;
let pauseAllActive   = false;
let pipActive        = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const searchInput      = document.getElementById("searchInput");
const searchWrap       = document.getElementById("searchWrap");
const tabList          = document.getElementById("tabList");
const emptyState       = document.getElementById("emptyState");
const emptyMsg         = document.getElementById("emptyMsg");
const errorMsg         = document.getElementById("errorMsg");
const audioCount       = document.getElementById("audioCount");
const allCount         = document.getElementById("allCount");
const volumePanel      = document.getElementById("volumePanel");
const volumeSlider     = document.getElementById("volumeSlider");
const volDisplay       = document.getElementById("volDisplay");
const volumePanelTitle = document.getElementById("volumePanelTitle");
const volumePanelClose = document.getElementById("volumePanelClose");

// Controls panel refs
const controlsPanel    = document.getElementById("controlsPanel");
const mediaStatusDot   = document.getElementById("mediaStatusDot");
const seekbarWrap      = document.getElementById("seekbarWrap");
const seekCurrent      = document.getElementById("seekCurrent");
const seekDuration     = document.getElementById("seekDuration");
const seekbarFill      = document.getElementById("seekbarFill");
const seekSlider       = document.getElementById("seekSlider");
const noMediaMsg       = document.getElementById("noMediaMsg");
const ctrlToast        = document.getElementById("ctrlToast");
const btnPrev          = document.getElementById("btnPrev");
const btnNext          = document.getElementById("btnNext");
const btnSkipAd        = document.getElementById("btnSkipAd");
const skipAdLabel      = document.getElementById("skipAdLabel");
const skipAdCountdown  = document.getElementById("skipAdCountdown");
const btnPip           = document.getElementById("btnPip");
const btnMuteAll       = document.getElementById("btnMuteAll");
const btnPauseAll      = document.getElementById("btnPauseAll");
const btnResetVolumes  = document.getElementById("btnResetVolumes");
const muteAllState     = document.getElementById("muteAllState");
const pauseAllState    = document.getElementById("pauseAllState");
const resetState       = document.getElementById("resetState");

// ─── Messaging ────────────────────────────────────────────────────────────────

function send(action, payload = {}) {
  return chrome.runtime.sendMessage({ type: MSG, action, payload });
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.toggle("hidden", !msg);
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map(p =>
    p.toLowerCase() === query.toLowerCase()
      ? `<mark>${escapeHtml(p)}</mark>`
      : escapeHtml(p)
  ).join("");
}

function volumeToPercent(v) { return Math.round(v * 100) + "%"; }

function formatTime(secs) {
  if (!secs || !isFinite(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

let toastTimer = null;
function showToast(msg, isError = false) {
  ctrlToast.textContent = msg;
  ctrlToast.className = "ctrl-toast" + (isError ? " error-toast" : "");
  ctrlToast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ctrlToast.classList.add("hidden"), 2400);
}

// ─── Filtered tab list ────────────────────────────────────────────────────────

function getFilteredTabs() {
  let tabs = currentView === "audio"
    ? allTabs.filter(t => t.audible || (volumes[t.id] != null && volumes[t.id] !== 1))
    : allTabs;

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    tabs = tabs.filter(t =>
      t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)
    );
  }
  return tabs;
}

// ─── View switching ───────────────────────────────────────────────────────────

function setView(view) {
  currentView = view;
  expandedTabId = null;

  // Show/hide panels
  const isControls = view === "controls";
  tabList.classList.toggle("hidden", isControls);
  emptyState.classList.toggle("hidden", true);  // will re-evaluate in render()
  controlsPanel.classList.toggle("hidden", !isControls);
  searchWrap.classList.toggle("hidden", isControls);

  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.view === view);
  });

  if (isControls) {
    stopSeekPoller();
    startSeekPoller();
  } else {
    stopSeekPoller();
    render();
  }
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

// ─── Render tab list ──────────────────────────────────────────────────────────

function render() {
  if (currentView === "controls") return;

  const filtered = getFilteredTabs();
  const audioCnt = allTabs.filter(t => t.audible).length;

  audioCount.textContent = audioCnt;
  allCount.textContent   = allTabs.length;
  tabList.innerHTML      = "";

  if (filtered.length === 0) {
    emptyState.classList.remove("hidden");
    emptyMsg.textContent = searchQuery
      ? `No tabs match "${searchQuery}"`
      : currentView === "audio"
        ? "No audio tabs right now"
        : "No tabs open";
    return;
  }

  emptyState.classList.add("hidden");

  for (const tab of filtered) {
    tabList.appendChild(buildTabRow(tab));
    tabList.appendChild(buildActionsRow(tab));
  }
}

function buildTabRow(tab) {
  const row = document.createElement("div");
  row.className = "tab-row"
    + (tab.active    ? " is-active"   : "")
    + (tab.discarded ? " is-discarded" : "");
  row.dataset.tabId = tab.id;
  if (expandedTabId === tab.id) row.classList.add("expanded");
  row.tabIndex = 0;

  // Favicon
  const faviconWrap = document.createElement("div");
  if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
    const img = document.createElement("img");
    img.className = "tab-favicon";
    img.src = tab.favIconUrl;
    img.width = img.height = 16;
    img.onerror = () => { faviconWrap.innerHTML = fallbackFaviconSvg(); };
    faviconWrap.appendChild(img);
  } else {
    faviconWrap.innerHTML = fallbackFaviconSvg();
  }

  // Info
  const info = document.createElement("div");
  info.className = "tab-info";
  const title = document.createElement("div");
  title.className = "tab-title";
  title.innerHTML = highlight(tab.title || getDomain(tab.url), searchQuery);
  const url = document.createElement("div");
  url.className = "tab-url";
  url.innerHTML = highlight(getDomain(tab.url), searchQuery);
  info.append(title, url);

  // Badges
  const badges = document.createElement("div");
  badges.className = "tab-badges";

  if (tab.audible) {
    const pill = document.createElement("span");
    const isMuted = tab.mutedInfo?.muted;
    pill.className = "audio-pill" + (isMuted ? " muted" : "");
    pill.innerHTML = isMuted
      ? `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg> Muted`
      : `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Audio`;
    badges.appendChild(pill);
  }

  if (tab.discarded) {
    const s = document.createElement("span");
    s.className = "sleep-badge";
    s.textContent = "Sleeping";
    badges.appendChild(s);
  }

  const vol = volumes[tab.id];
  if (vol != null && vol !== 1) {
    const vb = document.createElement("span");
    vb.className = "sleep-badge";
    vb.style.color = vol > 1 ? "var(--warning)" : "var(--muted)";
    vb.textContent = volumeToPercent(vol);
    badges.appendChild(vb);
  }

  row.append(faviconWrap, info, badges);

  row.addEventListener("click", (e) => {
    if (e.target.closest(".action-btn, .icon-btn")) return;
    expandedTabId = expandedTabId === tab.id ? null : tab.id;
    render();
  });
  row.addEventListener("dblclick", () => jumpToTab(tab.id));

  return row;
}

function buildActionsRow(tab) {
  const div = document.createElement("div");
  div.className = "tab-actions";
  if (expandedTabId !== tab.id) div.style.display = "none";

  const jumpBtn = makeActionBtn(
    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Jump`,
    "Jump to this tab"
  );
  jumpBtn.addEventListener("click", (e) => { e.stopPropagation(); jumpToTab(tab.id); });

  const isMuted = tab.mutedInfo?.muted;
  const muteBtn = makeActionBtn(
    isMuted
      ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg> Unmute`
      : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Mute`,
    isMuted ? "Unmute tab" : "Mute tab"
  );
  muteBtn.classList.add("mute-btn");
  if (isMuted) muteBtn.classList.add("muted");
  muteBtn.addEventListener("click", async (e) => { e.stopPropagation(); await toggleMute(tab.id, !isMuted); });

  const volBtn = makeActionBtn(
    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Volume ${volumeToPercent(volumes[tab.id] ?? 1)}`,
    "Adjust volume"
  );
  if (volumes[tab.id] != null && volumes[tab.id] !== 1) volBtn.classList.add("active");
  volBtn.addEventListener("click", (e) => { e.stopPropagation(); openVolumePanel(tab); });

  const sleepBtn = makeActionBtn(
    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> ${tab.discarded ? "Wake" : "Sleep"}`,
    tab.discarded ? "Click to wake tab" : "Freeze tab to free RAM"
  );
  sleepBtn.classList.add("danger");
  sleepBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    tab.discarded ? await jumpToTab(tab.id) : await sleepTab(tab.id);
  });

  div.append(jumpBtn, muteBtn, volBtn, sleepBtn);
  return div;
}

function makeActionBtn(html, title) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "action-btn";
  btn.innerHTML = html;
  btn.title = title;
  return btn;
}

function fallbackFaviconSvg() {
  return `<div class="tab-favicon-fallback"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg></div>`;
}

// ─── Tab actions ──────────────────────────────────────────────────────────────

async function jumpToTab(tabId) {
  showError("");
  try {
    const res = await send("FOCUS_TAB", { tabId });
    if (!res?.ok) showError(res?.error ?? "Could not switch tab");
    window.close();
  } catch (e) { showError(String(e)); }
}

async function toggleMute(tabId, muted) {
  showError("");
  try {
    const res = await send("MUTE_TAB", { tabId, muted });
    if (!res?.ok) { showError(res?.error ?? "Mute failed"); return; }
    const tab = allTabs.find(t => t.id === tabId);
    if (tab) tab.mutedInfo = { muted };
    render();
  } catch (e) { showError(String(e)); }
}

async function sleepTab(tabId) {
  showError("");
  try {
    const res = await send("SLEEP_TAB", { tabId });
    if (!res?.ok) { showError(res?.error ?? "Cannot sleep this tab"); return; }
    const tab = allTabs.find(t => t.id === tabId);
    if (tab) tab.discarded = true;
    expandedTabId = null;
    render();
  } catch (e) { showError(String(e)); }
}

// ─── Volume panel ─────────────────────────────────────────────────────────────

function openVolumePanel(tab) {
  volumePanelTabId = tab.id;
  volumePanelTitle.textContent = tab.title || getDomain(tab.url);
  const cur = volumes[tab.id] ?? 1;
  volumeSlider.value = cur;
  volDisplay.textContent = volumeToPercent(cur);
  updatePresetActive(cur);
  volumePanel.classList.remove("hidden");
}

function closeVolumePanel() {
  volumePanel.classList.add("hidden");
  volumePanelTabId = null;
}

async function applyVolume(val) {
  if (volumePanelTabId == null) return;
  volDisplay.textContent = volumeToPercent(val);
  updatePresetActive(val);
  try {
    const res = await send("SET_VOLUME", { tabId: volumePanelTabId, volume: val });
    if (!res?.ok) { showError(res?.error ?? "Volume failed"); return; }
    volumes[volumePanelTabId] = val;
    render();
  } catch (e) { showError(String(e)); }
}

function updatePresetActive(val) {
  document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.classList.toggle("active", parseFloat(btn.dataset.vol) === val);
  });
}

volumeSlider.addEventListener("input", () => {
  volDisplay.textContent = volumeToPercent(parseFloat(volumeSlider.value));
  updatePresetActive(parseFloat(volumeSlider.value));
});
volumeSlider.addEventListener("change", () => applyVolume(parseFloat(volumeSlider.value)));
volumePanelClose.addEventListener("click", closeVolumePanel);
document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const val = parseFloat(btn.dataset.vol);
    volumeSlider.value = val;
    applyVolume(val);
  });
});

// ─── Search ───────────────────────────────────────────────────────────────────

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim();
  expandedTabId = null;
  render();
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const filtered = getFilteredTabs();
    if (filtered.length > 0) jumpToTab(filtered[0].id);
  }
  if (e.key === "Escape") {
    if (searchQuery) { searchInput.value = ""; searchQuery = ""; render(); }
    else closeVolumePanel();
  }
  if (e.key === "ArrowDown") { e.preventDefault(); focusNextTabRow(1); }
  if (e.key === "ArrowUp")   { e.preventDefault(); focusNextTabRow(-1); }
});

function focusNextTabRow(dir) {
  const rows = [...tabList.querySelectorAll(".tab-row")];
  if (!rows.length) return;
  const cur = tabList.querySelector(".tab-row:focus");
  let idx = cur ? rows.indexOf(cur) : -1;
  rows[(idx + dir + rows.length) % rows.length].focus();
}

tabList.addEventListener("keydown", (e) => {
  const row = e.target.closest(".tab-row");
  if (!row) return;
  if (e.key === "Enter") jumpToTab(parseInt(row.dataset.tabId));
  if (e.key === "ArrowDown") { e.preventDefault(); focusNextTabRow(1); }
  if (e.key === "ArrowUp")   { e.preventDefault(); focusNextTabRow(-1); }
});

document.addEventListener("keydown", (e) => {
  const isMeta = e.metaKey || e.ctrlKey;
  if (isMeta && e.key === "k") { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  if (e.key === "Escape" && document.activeElement !== searchInput) closeVolumePanel();
});

// ─── Refresh ──────────────────────────────────────────────────────────────────

document.getElementById("btnRefresh").addEventListener("click", () => refresh());

async function refresh() {
  showError("");
  try {
    const [tabsRes, volsRes] = await Promise.all([
      send("GET_ALL_TABS"),
      send("GET_VOLUMES"),
    ]);
    if (!tabsRes?.ok) { showError(tabsRes?.error ?? "Failed to load tabs"); return; }
    allTabs  = tabsRes.tabs ?? [];
    volumes  = volsRes?.volumes ?? {};
    audioCount.textContent = allTabs.filter(t => t.audible).length;
    allCount.textContent   = allTabs.length;
    render();
  } catch (e) { showError(String(e)); }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE-01 — CONTROLS PANEL
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. Seekbar / media poller ─────────────────────────────────────────────────

async function pollMediaState() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;

    const res = await send("GET_MEDIA_STATE", { tabId: activeTab.id });
    if (!res?.ok || !res.state) {
      updateSeekbarNoMedia();
      return;
    }
    mediaState = res.state;
    updateSeekbarUI(mediaState);
  } catch {
    updateSeekbarNoMedia();
  }
}

function updateSeekbarUI(state) {
  seekbarWrap.classList.remove("hidden");
  noMediaMsg.classList.add("hidden");

  const pct = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
  seekbarFill.style.width = `${pct}%`;
  seekSlider.value = Math.round((pct / 100) * 1000);
  seekCurrent.textContent  = formatTime(state.currentTime);
  seekDuration.textContent = formatTime(state.duration);

  // Status dot
  mediaStatusDot.className = "media-status-dot " + (state.paused ? "paused" : "playing");
}

function updateSeekbarNoMedia() {
  seekbarWrap.classList.add("hidden");
  noMediaMsg.classList.remove("hidden");
  mediaStatusDot.className = "media-status-dot";
}

// User scrubs the seekbar
let isSeeking = false;

seekSlider.addEventListener("mousedown", () => { isSeeking = true; });
seekSlider.addEventListener("touchstart", () => { isSeeking = true; }, { passive: true });

seekSlider.addEventListener("input", () => {
  if (!mediaState) return;
  const pct = parseInt(seekSlider.value) / 1000;
  const time = pct * (mediaState.duration || 0);
  seekbarFill.style.width = `${pct * 100}%`;
  seekCurrent.textContent = formatTime(time);
});

seekSlider.addEventListener("change", async () => {
  isSeeking = false;
  if (!mediaState) return;
  const pct = parseInt(seekSlider.value) / 1000;
  const time = pct * (mediaState.duration || 0);

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;
    await send("SEEK_MEDIA", { tabId: activeTab.id, time });
  } catch { /* ignore */ }
});

function startSeekPoller() {
  void pollMediaState();
  seekPollerTimer = setInterval(() => {
    if (!isSeeking) void pollMediaState();
  }, 1000);
  // Ad poller runs every 800ms — needs to catch the skip window quickly
  void pollAdState();
  adPollerTimer = setInterval(() => void pollAdState(), 800);
}

function stopSeekPoller() {
  if (seekPollerTimer) { clearInterval(seekPollerTimer); seekPollerTimer = null; }
  if (adPollerTimer)   { clearInterval(adPollerTimer);   adPollerTimer   = null; }
}

// ── Ad state poller ───────────────────────────────────────────────────────────

async function pollAdState() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) { setSkipAdState("none"); return; }

    const res = await send("GET_AD_STATE", { tabId: activeTab.id });
    adState = res;

    if (!res?.adPlaying) {
      setSkipAdState("none");
    } else if (res.skippable) {
      setSkipAdState("skippable");
    } else {
      setSkipAdState("playing", res.countdown);
    }
  } catch {
    setSkipAdState("none");
  }
}

/**
 * Drive the Skip Ad button through three visual states:
 *  "none"      — no ad, button dim + disabled
 *  "playing"   — ad playing, not yet skippable — pulse amber, disabled
 *  "skippable" — skip window open — bright, clickable
 */
function setSkipAdState(state, countdown = null) {
  btnSkipAd.classList.remove("ad-playing", "ad-skippable");
  skipAdCountdown.classList.add("hidden");

  switch (state) {
    case "none":
      btnSkipAd.disabled = true;
      skipAdLabel.textContent = "No Ad";
      btnSkipAd.title = "No ad detected on this tab";
      break;

    case "playing":
      btnSkipAd.disabled = false;
      btnSkipAd.classList.add("ad-playing", "ad-skippable");
      skipAdLabel.textContent = "Force Skip";
      btnSkipAd.title = "Force skip this ad immediately";
      if (countdown) {
        skipAdCountdown.textContent = countdown;
        skipAdCountdown.classList.remove("hidden");
      }
      break;

    case "skippable":
      btnSkipAd.disabled = false;
      btnSkipAd.classList.add("ad-skippable");
      skipAdLabel.textContent = "Skip Ad";
      btnSkipAd.title = "Click to skip this ad now";
      break;
  }
}

// ── 2. Skip Ad ────────────────────────────────────────────────────────────────

btnSkipAd.addEventListener("click", async () => {
  if (btnSkipAd.disabled) return;
  // Optimistic UI — go dim immediately so user knows click registered
  setSkipAdState("none");
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;
    const res = await send("SKIP_AD", { tabId: activeTab.id });
    if (res?.skipped) {
      showToast("✓ Ad skipped");
      // Re-poll quickly to confirm ad is gone
      setTimeout(() => void pollAdState(), 600);
    } else {
      showToast("Skip failed — try again", true);
      // Re-check real state
      setTimeout(() => void pollAdState(), 400);
    }
  } catch (e) {
    showToast(String(e), true);
    setTimeout(() => void pollAdState(), 400);
  }
});

// ── 3. PiP toggle ────────────────────────────────────────────────────────────

btnPip.addEventListener("click", async () => {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;
    const res = await send("PIP_TOGGLE", { tabId: activeTab.id });

    if (res?.state === "entered") {
      pipActive = true;
      btnPip.classList.add("active");
      showToast("✓ Picture-in-Picture activated");
    } else if (res?.state === "exited") {
      pipActive = false;
      btnPip.classList.remove("active");
      showToast("PiP closed");
    } else if (res?.state === "unsupported") {
      showToast("PiP not supported on this page", true);
    } else {
      showToast(res?.state ?? "PiP failed", true);
    }
  } catch (e) { showToast(String(e), true); }
});

// ── 4. Playlist Prev / Next ───────────────────────────────────────────────────

btnPrev.addEventListener("click", async () => {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;
    const res = await send("PLAYLIST_PREV", { tabId: activeTab.id });
    if (!res?.clicked) showToast("No previous track button found", true);
  } catch (e) { showToast(String(e), true); }
});

btnNext.addEventListener("click", async () => {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) return;
    const res = await send("PLAYLIST_NEXT", { tabId: activeTab.id });
    if (!res?.clicked) showToast("No next track button found", true);
  } catch (e) { showToast(String(e), true); }
});

// ── 5. Mute All ───────────────────────────────────────────────────────────────

btnMuteAll.addEventListener("click", async () => {
  muteAllActive = !muteAllActive;
  try {
    const res = await send("MUTE_ALL_TABS", { muted: muteAllActive });
    const count = res?.count ?? 0;

    muteAllState.textContent = muteAllActive ? "ON" : "OFF";
    muteAllState.className   = "global-btn-badge" + (muteAllActive ? " on" : "");
    btnMuteAll.classList.toggle("active-state", muteAllActive);

    showToast(muteAllActive
      ? `✓ ${count} tab${count !== 1 ? "s" : ""} muted`
      : `✓ ${count} tab${count !== 1 ? "s" : ""} unmuted`
    );

    // Sync local tab mute state
    allTabs.forEach(t => { if (t.audible) t.mutedInfo = { muted: muteAllActive }; });
  } catch (e) { showToast(String(e), true); muteAllActive = !muteAllActive; }
});

// ── 6. Pause All ─────────────────────────────────────────────────────────────

btnPauseAll.addEventListener("click", async () => {
  pauseAllActive = !pauseAllActive;
  try {
    const res = await send("PAUSE_ALL_TABS");
    if (!res?.ok) { showToast("Pause all failed", true); pauseAllActive = !pauseAllActive; return; }

    pauseAllState.textContent = pauseAllActive ? "ON" : "OFF";
    pauseAllState.className   = "global-btn-badge" + (pauseAllActive ? " on" : "");
    btnPauseAll.classList.toggle("active-state", pauseAllActive);

    showToast(pauseAllActive ? "✓ All media paused" : "✓ Pause cleared (media won't auto-resume)");

    // Reflect in seekbar
    if (mediaState) { mediaState.paused = true; mediaStatusDot.className = "media-status-dot paused"; }
  } catch (e) { showToast(String(e), true); pauseAllActive = !pauseAllActive; }
});

// ── 7. Reset All Volumes ──────────────────────────────────────────────────────

btnResetVolumes.addEventListener("click", async () => {
  resetState.textContent = "…";
  try {
    const res = await send("RESET_ALL_VOLUMES");
    volumes = {};

    resetState.textContent = "✓";
    resetState.className   = "global-btn-badge reset-badge ok";
    setTimeout(() => {
      resetState.textContent = "—";
      resetState.className   = "global-btn-badge reset-badge";
    }, 2000);

    showToast(`✓ Reset ${res?.resetCount ?? "all"} tabs to 100%`);
  } catch (e) {
    resetState.textContent = "✗";
    showToast(String(e), true);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

void refresh();
searchInput.focus();
setSkipAdState("none");
