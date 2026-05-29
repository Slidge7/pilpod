/**
 * PilPod standalone popup — works without the desktop application.
 * Features: audio dashboard, mute toggle, volume boost, tab sleep, tab navigator, keyboard jump.
 */

"use strict";

const MSG = "PILPOD_STANDALONE";

// ─── State ────────────────────────────────────────────────────────────────────

let allTabs = [];
let volumes = {}; // tabId -> gain (0-6)
let currentView = "audio"; // "audio" | "all"
let searchQuery = "";
let expandedTabId = null;
let volumePanelTabId = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const searchInput    = document.getElementById("searchInput");
const tabList        = document.getElementById("tabList");
const emptyState     = document.getElementById("emptyState");
const emptyMsg       = document.getElementById("emptyMsg");
const errorMsg       = document.getElementById("errorMsg");
const audioCount     = document.getElementById("audioCount");
const allCount       = document.getElementById("allCount");
const volumePanel    = document.getElementById("volumePanel");
const volumeSlider   = document.getElementById("volumeSlider");
const volDisplay     = document.getElementById("volDisplay");
const volumePanelTitle = document.getElementById("volumePanelTitle");
const volumePanelClose = document.getElementById("volumePanelClose");

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
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Highlight search query occurrences in a string */
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

function volumeToPercent(v) {
  return Math.round(v * 100) + "%";
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

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const filtered = getFilteredTabs();
  const audioCnt = allTabs.filter(t => t.audible).length;

  audioCount.textContent = audioCnt;
  allCount.textContent = allTabs.length;

  tabList.innerHTML = "";

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
    const row = buildTabRow(tab);
    tabList.appendChild(row);

    // Inline actions row (shown when expanded)
    const actions = buildActionsRow(tab);
    tabList.appendChild(actions);
  }
}

function buildTabRow(tab) {
  const row = document.createElement("div");
  row.className = "tab-row" + (tab.active ? " is-active" : "") + (tab.discarded ? " is-discarded" : "");
  row.dataset.tabId = tab.id;
  if (expandedTabId === tab.id) row.classList.add("expanded");

  // Favicon
  const faviconWrap = document.createElement("div");
  if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
    const img = document.createElement("img");
    img.className = "tab-favicon";
    img.src = tab.favIconUrl;
    img.width = 16;
    img.height = 16;
    img.onerror = () => {
      faviconWrap.innerHTML = fallbackFaviconSvg();
    };
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
    const vbadge = document.createElement("span");
    vbadge.className = "sleep-badge";
    vbadge.style.color = vol > 1 ? "var(--warning)" : "var(--muted)";
    vbadge.textContent = volumeToPercent(vol);
    badges.appendChild(vbadge);
  }

  row.append(faviconWrap, info, badges);

  // Click: navigate to tab OR expand actions
  row.addEventListener("click", (e) => {
    if (e.target.closest(".action-btn, .icon-btn")) return;
    if (expandedTabId === tab.id) {
      expandedTabId = null;
    } else {
      expandedTabId = tab.id;
    }
    render();
  });

  // Double click: jump to tab immediately
  row.addEventListener("dblclick", () => jumpToTab(tab.id));

  return row;
}

function buildActionsRow(tab) {
  const div = document.createElement("div");
  div.className = "tab-actions";
  if (expandedTabId !== tab.id) {
    div.style.display = "none";
  }

  // Jump button
  const jumpBtn = makeActionBtn(
    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Jump`,
    "Jump to this tab"
  );
  jumpBtn.addEventListener("click", (e) => { e.stopPropagation(); jumpToTab(tab.id); });

  // Mute toggle
  const isMuted = tab.mutedInfo?.muted;
  const muteBtn = makeActionBtn(
    isMuted
      ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg> Unmute`
      : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Mute`,
    isMuted ? "Unmute tab" : "Mute tab"
  );
  muteBtn.classList.add("mute-btn");
  if (isMuted) muteBtn.classList.add("muted");
  muteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await toggleMute(tab.id, !isMuted);
  });

  // Volume boost
  const volBtn = makeActionBtn(
    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Volume ${volumeToPercent(volumes[tab.id] ?? 1)}`,
    "Adjust volume"
  );
  if (volumes[tab.id] != null && volumes[tab.id] !== 1) volBtn.classList.add("active");
  volBtn.addEventListener("click", (e) => { e.stopPropagation(); openVolumePanel(tab); });

  // Sleep / discard
  const sleepBtn = makeActionBtn(
    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> ${tab.discarded ? "Wake" : "Sleep"}`,
    tab.discarded ? "Tab is sleeping — click to wake" : "Freeze tab to free RAM"
  );
  sleepBtn.classList.add("danger");
  sleepBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (tab.discarded) {
      // Wake: just focus it
      await jumpToTab(tab.id);
    } else {
      await sleepTab(tab.id);
    }
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

// ─── Actions ──────────────────────────────────────────────────────────────────

async function jumpToTab(tabId) {
  showError("");
  try {
    const res = await send("FOCUS_TAB", { tabId });
    if (!res?.ok) showError(res?.error ?? "Could not switch tab");
    // Close popup after jumping
    window.close();
  } catch (e) {
    showError(String(e));
  }
}

async function toggleMute(tabId, muted) {
  showError("");
  try {
    const res = await send("MUTE_TAB", { tabId, muted });
    if (!res?.ok) { showError(res?.error ?? "Mute failed"); return; }
    // Update local tab state
    const tab = allTabs.find(t => t.id === tabId);
    if (tab) tab.mutedInfo = { muted };
    render();
  } catch (e) {
    showError(String(e));
  }
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
  } catch (e) {
    showError(String(e));
  }
}

// ─── Volume panel ─────────────────────────────────────────────────────────────

function openVolumePanel(tab) {
  volumePanelTabId = tab.id;
  volumePanelTitle.textContent = tab.title || getDomain(tab.url);
  const currentVol = volumes[tab.id] ?? 1;
  volumeSlider.value = currentVol;
  volDisplay.textContent = volumeToPercent(currentVol);
  updatePresetActive(currentVol);
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
  } catch (e) {
    showError(String(e));
  }
}

function updatePresetActive(val) {
  document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.classList.toggle("active", parseFloat(btn.dataset.vol) === val);
  });
}

volumeSlider.addEventListener("input", () => {
  const val = parseFloat(volumeSlider.value);
  volDisplay.textContent = volumeToPercent(val);
  updatePresetActive(val);
});

volumeSlider.addEventListener("change", () => {
  applyVolume(parseFloat(volumeSlider.value));
});

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
    if (filtered.length === 1) {
      jumpToTab(filtered[0].id);
    } else if (filtered.length > 0 && expandedTabId == null) {
      // Jump to first match
      jumpToTab(filtered[0].id);
    }
  }
  if (e.key === "Escape") {
    if (searchQuery) {
      searchInput.value = "";
      searchQuery = "";
      render();
    } else {
      closeVolumePanel();
    }
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    focusNextTabRow(1);
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    focusNextTabRow(-1);
  }
});

function focusNextTabRow(direction) {
  const rows = [...tabList.querySelectorAll(".tab-row")];
  if (rows.length === 0) return;
  const current = tabList.querySelector(".tab-row:focus");
  let idx = current ? rows.indexOf(current) : -1;
  idx = (idx + direction + rows.length) % rows.length;
  rows[idx].focus();
}

// Make tab rows keyboard navigable
tabList.addEventListener("keydown", (e) => {
  const row = e.target.closest(".tab-row");
  if (!row) return;
  if (e.key === "Enter") {
    const tabId = parseInt(row.dataset.tabId);
    jumpToTab(tabId);
  }
  if (e.key === "ArrowDown") { e.preventDefault(); focusNextTabRow(1); }
  if (e.key === "ArrowUp") { e.preventDefault(); focusNextTabRow(-1); }
});

// ─── View switching ───────────────────────────────────────────────────────────

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;
    expandedTabId = null;
    render();
  });
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
    allTabs = tabsRes.tabs ?? [];
    volumes = volsRes?.volumes ?? {};
    render();
  } catch (e) {
    showError(String(e));
  }
}

// ─── Keyboard shortcut: focus search ─────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  const isMeta = e.metaKey || e.ctrlKey;
  if (isMeta && e.key === "k") {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  if (e.key === "Escape" && document.activeElement !== searchInput) {
    closeVolumePanel();
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

void refresh();

// Auto-focus search for keyboard jump workflow
searchInput.focus();
