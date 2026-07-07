import type { DownloadTask, DownloadStatusKind, ProgressEvent } from "./types";
import { normalizeUrl } from "../vault/lib/normalizeUrl";

/** Merge a full-task snapshot (dl://update) into the task map. */
export function applyTaskUpdate(
  tasks: ReadonlyMap<string, DownloadTask>,
  task: DownloadTask,
): Map<string, DownloadTask> {
  const next = new Map(tasks);
  next.set(task.id, task);
  return next;
}

/** Merge a lightweight dl://progress event; ignores unknown task ids. */
export function applyProgress(
  tasks: ReadonlyMap<string, DownloadTask>,
  e: ProgressEvent,
): Map<string, DownloadTask> {
  const existing = tasks.get(e.id);
  if (!existing) return new Map(tasks);
  const next = new Map(tasks);
  next.set(e.id, {
    ...existing,
    percent: e.percent,
    speed: e.speed,
    eta: e.eta,
    status: existing.status.kind === "queued" ? { kind: "downloading" } : existing.status,
  });
  return next;
}

/** Newest first, mirroring the Rust snapshot order. */
export function sortTasks(tasks: ReadonlyMap<string, DownloadTask>): DownloadTask[] {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function isTerminal(task: DownloadTask): boolean {
  return ["done", "cancelled", "error"].includes(task.status.kind);
}

export function formatBytes(bytes: number | null): string | null {
  if (bytes == null || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Mirrors the Rust-side sanitizer so the UI preview matches what lands on disk. */
export function previewFilename(raw: string): string {
  let s = "";
  for (const c of raw) {
    s += /[\\/:*?"<>|]/.test(c) || c.charCodeAt(0) < 0x20 ? "_" : c;
    if (s.length >= 200) break;
  }
  s = s.trim().replace(/^\.+|\.+$/g, "").trim();
  const stem = s.split(".")[0] ?? "";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) s = `_${s}`;
  return s;
}

export function statusLabel(task: DownloadTask): string {
  switch (task.status.kind) {
    case "queued":
      return "Queued";
    case "downloading":
      return `${task.percent.toFixed(0)}%${task.speed ? ` · ${task.speed}` : ""}${task.eta ? ` · ${task.eta}` : ""}`;
    case "muxing":
      return "Processing…";
    case "done":
      return "Done";
    case "cancelled":
      return "Cancelled";
    case "error":
      return "Failed";
  }
}

// -- In-tab download button helpers --

export type TabDownloadStatus = "idle" | "active" | "done" | "error";

const ACTIVE_KINDS: ReadonlySet<DownloadStatusKind> = new Set([
  "queued",
  "downloading",
  "muxing",
]);

/**
 * Derive a button status for a given tab URL from the current download queue.
 * Newest matching task wins.
 */
export function downloadStatusForUrl(
  tasks: ReadonlyMap<string, DownloadTask>,
  tabUrl: string,
): TabDownloadStatus {
  const norm = normalizeUrl(tabUrl);
  if (!norm) return "idle";

  let best: DownloadTask | null = null;
  for (const t of tasks.values()) {
    if (normalizeUrl(t.url) !== norm) continue;
    if (!best || t.createdAt > best.createdAt) best = t;
  }
  if (!best) return "idle";
  if (best.status.kind === "done") return "done";
  if (best.status.kind === "error") return "error";
  if (ACTIVE_KINDS.has(best.status.kind)) return "active";
  return "idle"; // cancelled
}

// -- Terminal-first sort (for float card) --

const TERMINAL_KINDS: ReadonlySet<DownloadStatusKind> = new Set([
  "done",
  "cancelled",
  "error",
]);

/**
 * Sort tasks with terminal states first (done/error/cancelled), then active,
 * newest-first within each group.
 */
export function sortTasksTerminalFirst(
  tasks: ReadonlyMap<string, DownloadTask>,
): DownloadTask[] {
  return [...tasks.values()].sort((a, b) => {
    const aTerminal = TERMINAL_KINDS.has(a.status.kind) ? 0 : 1;
    const bTerminal = TERMINAL_KINDS.has(b.status.kind) ? 0 : 1;
    if (aTerminal !== bTerminal) return aTerminal - bTerminal;
    return b.createdAt - a.createdAt;
  });
}
