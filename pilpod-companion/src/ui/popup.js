/**
 * PilPod Companion popup UI.
 */

"use strict";

import { MSG_POPUP } from "../shared/protocol.js";

const connectionDot = document.getElementById("connectionDot");
const connectionLabel = document.getElementById("connectionLabel");
const activeContext = document.getElementById("activeContext");
const contextText = document.getElementById("contextText");
const discoveryActions = document.getElementById("discoveryActions");
const addSiteBtn = document.getElementById("addSiteBtn");
const dismissSiteBtn = document.getElementById("dismissSiteBtn");
const rulesList = document.getElementById("rulesList");
const manualDomain = document.getElementById("manualDomain");
const manualAddBtn = document.getElementById("manualAddBtn");
const errorMsg = document.getElementById("errorMsg");

/**
 * @param {string} action
 * @param {object} [payload]
 */
function send(action, payload = {}) {
  return chrome.runtime.sendMessage({ type: MSG_POPUP, action, payload });
}

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.classList.toggle("hidden", !message);
}

function setConnection(connectionState) {
  const connected = connectionState === "connected";
  connectionDot.classList.toggle("dot-green", connected);
  connectionDot.classList.toggle("dot-red", !connected);
  connectionLabel.textContent = connected ? "Desktop connected" : "Disconnected";
}

function renderRules(config) {
  rulesList.innerHTML = "";
  const rules = config?.customRules ?? [];

  if (rules.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-rules";
    empty.textContent = "No custom sites yet.";
    rulesList.appendChild(empty);
    return;
  }

  for (const rule of rules) {
    const li = document.createElement("li");
    li.className = "rule-item";

    const domain = document.createElement("span");
    domain.className = "rule-domain";
    domain.textContent = rule.domain;
    domain.title = rule.domain;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = `rule-toggle${rule.enabled ? " enabled" : ""}`;
    toggle.textContent = rule.enabled ? "On" : "Off";
    toggle.addEventListener("click", async () => {
      try {
        const res = await send("TOGGLE_RULE", { id: rule.id });
        if (res?.ok) await refresh();
      } catch (err) {
        showError(String(err));
      }
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "rule-delete";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      try {
        const res = await send("DELETE_RULE", { id: rule.id });
        if (res?.ok) await refresh();
      } catch (err) {
        showError(String(err));
      }
    });

    li.append(domain, toggle, del);
    rulesList.appendChild(li);
  }
}

function renderActiveContext(activeTab) {
  if (!activeTab) {
    activeContext.classList.add("hidden");
    return;
  }

  activeContext.classList.remove("hidden");
  discoveryActions.classList.add("hidden");

  if (activeTab.pendingHostname) {
    contextText.textContent = `Media detected on ${activeTab.pendingHostname}. Add to PilPod?`;
    discoveryActions.classList.remove("hidden");
    addSiteBtn.textContent = `Add ${activeTab.pendingHostname}`;
    addSiteBtn.onclick = async () => {
      showError("");
      const res = await send("ADD_DOMAIN", {
        domain: activeTab.pendingHostname,
        tabId: activeTab.tabId,
      });
      if (!res?.ok) {
        showError(res?.error ?? "Failed to add site");
        return;
      }
      await refresh();
    };
    dismissSiteBtn.onclick = async () => {
      showError("");
      const res = await send("DISMISS_DOMAIN", {
        domain: activeTab.pendingHostname,
        tabId: activeTab.tabId,
      });
      if (!res?.ok) {
        showError(res?.error ?? "Failed to dismiss");
        return;
      }
      await refresh();
    };
    return;
  }

  if (activeTab.covered && activeTab.hasMedia) {
    contextText.textContent = `Tracking: ${activeTab.title || activeTab.url}`;
    return;
  }

  if (activeTab.covered) {
    contextText.textContent = `On tracked site: ${activeTab.title || activeTab.url}`;
    return;
  }

  contextText.textContent = "Active tab is not a tracked media site.";
}

async function refresh() {
  showError("");
  const res = await send("GET_STATE");
  if (!res?.ok) {
    showError(res?.error ?? "Failed to load state");
    return;
  }

  setConnection(res.connectionState);
  renderActiveContext(res.activeTab);
  renderRules(res.config);
}

manualAddBtn.addEventListener("click", async () => {
  const domain = manualDomain.value.trim();
  if (!domain) return;
  showError("");
  const res = await send("ADD_RULE_MANUAL", { domain });
  if (!res?.ok) {
    showError(res?.error ?? "Failed to add domain");
    return;
  }
  manualDomain.value = "";
  await refresh();
});

void refresh();
