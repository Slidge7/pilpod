import { useMemo } from "react";
import type { DownloadTask } from "../types";

export type QueuedTask = DownloadTask & { isActive: boolean; isFinished: boolean };

/** Derives sorted queue state from the raw tasks map. */
export function useDownloadQueue(tasks: Map<string, DownloadTask>): QueuedTask[] {
  return useMemo(() => {
    const list = Array.from(tasks.values()).sort(
      (a, b) => a.created_at - b.created_at,
    );
    return list.map((t) => ({
      ...t,
      isActive:
        t.status.type === "Downloading" ||
        t.status.type === "Muxing" ||
        t.status.type === "FetchingInfo",
      isFinished:
        t.status.type === "Done" ||
        t.status.type === "Cancelled" ||
        t.status.type === "Error",
    }));
  }, [tasks]);
}
