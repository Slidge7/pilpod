import type { DownloadTask } from "../types";

export function isActiveDownloadStatus(
  status: DownloadTask["status"],
): boolean {
  const t = status.type;
  return (
    t === "Queued" ||
    t === "Downloading" ||
    t === "Muxing" ||
    t === "FetchingInfo"
  );
}

function normalizeDownloadUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href.replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

/** Returns the in-progress download task matching a tab URL, if any. */
export function findActiveDownloadForUrl(
  tasks: Map<string, DownloadTask>,
  url: string,
): DownloadTask | undefined {
  const normalized = normalizeDownloadUrl(url);
  for (const task of tasks.values()) {
    if (!isActiveDownloadStatus(task.status)) continue;
    if (normalizeDownloadUrl(task.url) === normalized) return task;
  }
  return undefined;
}

export function downloadProgressLabel(task: DownloadTask): string {
  switch (task.status.type) {
    case "Queued":
      return "Queued";
    case "Muxing":
      return "Muxing";
    case "Downloading":
      return `${Math.round(task.percent)}%`;
    case "FetchingInfo":
      return "Fetching";
    default:
      return "…";
  }
}

export function downloadProgressTitle(task: DownloadTask): string {
  switch (task.status.type) {
    case "Queued":
      return "Download queued";
    case "Muxing":
      return "Muxing audio and video";
    case "Downloading":
      return task.speed
        ? `Downloading ${Math.round(task.percent)}% at ${task.speed}${
            task.eta ? ` · ${task.eta} left` : ""
          }`
        : `Downloading ${Math.round(task.percent)}%`;
    case "FetchingInfo":
      return "Fetching video info";
    default:
      return "Downloading";
  }
}
