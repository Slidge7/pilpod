import type { DetectedBrowser } from "../../../types/media";

/** Kind of a Dev Lab event-log entry (drives row color + filtering). */
export type DevLogKind =
  | "snapshot"
  | "browser-added"
  | "browser-removed"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "running"
  | "stopped"
  | "installed"
  | "tabs"
  | "action"
  | "error";

export type DevLogEntry = {
  ts: number;
  kind: DevLogKind;
  /** Display name (with profile label) of the browser row concerned, or "—". */
  subject: string;
  message: string;
};

export const LOG_MAX = 500;

function label(b: DetectedBrowser): string {
  return b.profileLabel ?? b.displayName;
}

function entry(
  ts: number,
  kind: DevLogKind,
  subject: string,
  message: string,
): DevLogEntry {
  return { ts, kind, subject, message };
}

/** Free-form entry for user actions / command results. */
export function actionEntry(
  subject: string,
  message: string,
  isError = false,
  ts: number = Date.now(),
): DevLogEntry {
  return entry(ts, isError ? "error" : "action", subject, message);
}

/**
 * Diff two consecutive `browsers://update` payloads into log entries.
 *
 * `prev === null` means "first payload seen" and produces a single snapshot
 * entry instead of one add-entry per browser.
 */
export function diffBrowsersPayload(
  prev: DetectedBrowser[] | null,
  next: DetectedBrowser[],
  ts: number = Date.now(),
): DevLogEntry[] {
  if (prev === null) {
    return [
      entry(
        ts,
        "snapshot",
        "—",
        `initial snapshot: ${next.length} browser row(s)`,
      ),
    ];
  }

  const out: DevLogEntry[] = [];
  const prevById = new Map(prev.map((b) => [b.id, b]));
  const nextById = new Map(next.map((b) => [b.id, b]));

  for (const b of next) {
    const old = prevById.get(b.id);
    if (!old) {
      out.push(
        entry(
          ts,
          "browser-added",
          label(b),
          `row added (os: ${b.osBrowserId}, tabs: ${b.tabCount})`,
        ),
      );
      continue;
    }

    if (old.extensionConnected !== b.extensionConnected) {
      out.push(
        b.extensionConnected
          ? entry(ts, "connected", label(b), "extension connected")
          : entry(ts, "disconnected", label(b), "extension disconnected"),
      );
    }
    if (
      (old.extensionReconnecting ?? false) !== (b.extensionReconnecting ?? false)
    ) {
      out.push(
        entry(
          ts,
          "reconnecting",
          label(b),
          b.extensionReconnecting ? "reconnecting…" : "reconnect window over",
        ),
      );
    }
    if (old.running !== b.running) {
      out.push(
        b.running
          ? entry(ts, "running", label(b), "browser process started")
          : entry(ts, "stopped", label(b), "browser process stopped"),
      );
    }
    if (old.extensionInstalled !== b.extensionInstalled) {
      out.push(
        entry(
          ts,
          "installed",
          label(b),
          b.extensionInstalled
            ? "extension marked installed"
            : "extension installed flag cleared",
        ),
      );
    }
    if (old.tabCount !== b.tabCount) {
      out.push(
        entry(ts, "tabs", label(b), `tabs ${old.tabCount} → ${b.tabCount}`),
      );
    }
  }

  for (const b of prev) {
    if (!nextById.has(b.id)) {
      out.push(entry(ts, "browser-removed", label(b), "row removed"));
    }
  }

  return out;
}

/** Append entries, newest first, trimmed to `max`. */
export function appendLog(
  log: DevLogEntry[],
  entries: DevLogEntry[],
  max: number = LOG_MAX,
): DevLogEntry[] {
  if (entries.length === 0) return log;
  const merged = [...entries.slice().reverse(), ...log];
  return merged.length > max ? merged.slice(0, max) : merged;
}
