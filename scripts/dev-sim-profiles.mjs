#!/usr/bin/env node
/**
 * PilPod Dev Lab profile simulator (Phase 4 testing tool).
 *
 * Impersonates N extension profiles over the real WS protocol v2
 * (/PROTOCOL.md) so you can exercise multi-profile labels, window groups,
 * focusWindow, Kill WS and reconnect behaviour WITHOUT launching real
 * browser profiles.
 *
 * Usage (PilPod app must be running):
 *   node scripts/dev-sim-profiles.mjs                 # 2 Chrome profiles
 *   node scripts/dev-sim-profiles.mjs --profiles 3    # 3 profiles
 *   node scripts/dev-sim-profiles.mjs --browser Firefox
 *   node scripts/dev-sim-profiles.mjs --windows 3 --tabs 4
 *
 * Profile UUIDs are persisted in scripts/.dev-sim-profiles.json so re-runs
 * (and app restarts) keep the SAME profiles — that's what proves the stable
 * "Profile 1 / Profile 2" numbering.
 *
 * Notes:
 * - The socket owner is node.exe (not a catalog browser), so the desktop's
 *   peer-PID check correctly yields no verified id and the slots show the
 *   "self-report" binding — expected for the simulator.
 * - Requires Node >= 21 (built-in WebSocket client).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, ".dev-sim-profiles.json");

// ── args ─────────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PROFILES = Number(arg("profiles", "2"));
const BROWSER = arg("browser", "Chrome");
const PORT = Number(arg("port", "17400"));
const WINDOWS = Number(arg("windows", "2"));
const TABS_PER_WINDOW = Number(arg("tabs", "3"));
const URL = `ws://127.0.0.1:${PORT}/ws`;

// ── persisted profile UUIDs ──────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function profileIds(browser, count) {
  const state = loadState();
  const key = browser.toLowerCase();
  const list = Array.isArray(state[key]) ? state[key] : [];
  while (list.length < count) list.push(randomUUID());
  state[key] = list;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  return list.slice(0, count);
}

// ── frame builders (mirror /PROTOCOL.md v2) ──────────────────────────────────

function hello(browserId) {
  return {
    t: "hello",
    v: 2,
    browserId,
    browser: { name: BROWSER, type: BROWSER.toLowerCase(), version: "126" },
    extVersion: "2.0.0",
    token: null,
    caps: { delta: true, progress: true },
  };
}

function makeTabs(profileIndex) {
  const tabs = [];
  let tabId = profileIndex * 1000 + 1;
  for (let w = 0; w < WINDOWS; w++) {
    const windowId = profileIndex * 100 + (w + 1);
    for (let i = 0; i < TABS_PER_WINDOW; i++) {
      tabs.push({
        tabId: tabId++,
        windowId,
        url: `https://example.com/p${profileIndex + 1}/w${w + 1}/t${i + 1}`,
        title: `SIM P${profileIndex + 1} · win ${w + 1} · tab ${i + 1}`,
        favIconUrl: "",
        active: i === 0,
        windowFocused: w === 0,
        audible: w === 0 && i === 0, // one audible tab in the focused window
        muted: false,
        pinned: false,
        index: i,
        media: null,
      });
    }
  }
  return tabs;
}

// ── one simulated profile ────────────────────────────────────────────────────

function runProfile(browserId, profileIndex) {
  const tag = `[sim p${profileIndex + 1} ${browserId.slice(0, 8)}]`;
  const ws = new WebSocket(URL);

  ws.addEventListener("open", () => {
    console.log(`${tag} connected → hello`);
    ws.send(JSON.stringify(hello(browserId)));
  });

  ws.addEventListener("message", (ev) => {
    let frame;
    try {
      frame = JSON.parse(ev.data);
    } catch {
      return;
    }
    switch (frame.t) {
      case "welcome":
        console.log(`${tag} welcome (bridge ${frame.bridge}) → full snapshot`);
        ws.send(
          JSON.stringify({ t: "full", rev: 1, tabs: makeTabs(profileIndex) }),
        );
        break;
      case "ping":
        ws.send(JSON.stringify({ t: "pong", seq: frame.seq }));
        break;
      case "resync":
        console.log(`${tag} resync requested → full snapshot`);
        ws.send(
          JSON.stringify({ t: "full", rev: 2, tabs: makeTabs(profileIndex) }),
        );
        break;
      case "cmd":
        console.log(
          `${tag} cmd received: ${frame.action} tab=${frame.tabId} value=${frame.value ?? "null"}`,
        );
        ws.send(JSON.stringify({ t: "ack", id: frame.id, ok: true, error: null }));
        break;
      default:
        break;
    }
  });

  ws.addEventListener("close", () => {
    console.log(`${tag} closed — reconnecting in 2s (Kill WS test)`);
    setTimeout(() => runProfile(browserId, profileIndex), 2000);
  });

  ws.addEventListener("error", () => {
    // close handler will fire and schedule the reconnect
  });

  return ws;
}

// ── main ─────────────────────────────────────────────────────────────────────

console.log(
  `PilPod profile simulator: ${PROFILES} × ${BROWSER} profile(s), ` +
    `${WINDOWS} window(s) × ${TABS_PER_WINDOW} tab(s) each → ${URL}`,
);
console.log("Expected in Dev Lab / dashboard:");
console.log(`  • ${PROFILES} slot rows labelled "${BROWSER} · Profile 1..${PROFILES}" (stable across restarts)`);
console.log(`  • ${WINDOWS} window groups per slot, focused window first`);
console.log("  • focusWindow / Kill WS actions logged here");
console.log("Ctrl+C to stop.\n");

const ids = profileIds(BROWSER, PROFILES);
ids.forEach((id, i) => runProfile(id, i));

process.on("SIGINT", () => {
  console.log("\nbye");
  process.exit(0);
});
