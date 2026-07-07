import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { applyProgress, applyTaskUpdate } from "../lib";
import {
  DL_EVENTS,
  type BinaryStatus,
  type DownloadSettings,
  type DownloadTask,
  type FetchInfoResponse,
  type Preset,
  type ProgressEvent,
} from "../types";

export interface StartArgs {
  url: string;
  preset: Preset;
  outputDir: string;
  filename: string | null;
  title: string | null;
  thumbnail: string | null;
}

/**
 * All downloader frontend state. Mounted only inside <PremiumGate> so the
 * gated commands are never invoked for free-tier users; the Rust side
 * re-checks entitlement on every call regardless.
 */
export function useDownloader() {
  const [tasks, setTasks] = useState<ReadonlyMap<string, DownloadTask>>(new Map());
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatus | null>(null);
  const [settings, setSettings] = useState<DownloadSettings | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastInfo, setLastInfo] = useState<FetchInfoResponse | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const unlisteners: Promise<UnlistenFn>[] = [
      listen<DownloadTask>(DL_EVENTS.update, (e) => {
        if (alive.current) setTasks((m) => applyTaskUpdate(m, e.payload));
      }),
      listen<ProgressEvent>(DL_EVENTS.progress, (e) => {
        if (alive.current) setTasks((m) => applyProgress(m, e.payload));
      }),
      listen<BinaryStatus>(DL_EVENTS.binaryStatus, (e) => {
        if (alive.current) setBinaryStatus(e.payload);
      }),
    ];

    // Hydrate from Rust state (source of truth -- survives UI remounts).
    invoke<DownloadTask[]>("dl_get_queue")
      .then((list) => {
        if (alive.current) setTasks(new Map(list.map((t) => [t.id, t])));
      })
      .catch(() => {});
    invoke<DownloadSettings>("dl_get_settings")
      .then((s) => {
        if (alive.current) setSettings(s);
      })
      .catch(() => {});
    invoke<BinaryStatus>("dl_check_binaries")
      .then((s) => {
        if (alive.current) setBinaryStatus(s);
      })
      .catch(() => {});

    return () => {
      alive.current = false;
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  const fetchInfo = useCallback(async (url: string): Promise<FetchInfoResponse | null> => {
    setFetching(true);
    setFetchError(null);
    setLastInfo(null);
    try {
      const res = await invoke<FetchInfoResponse>("dl_fetch_info", { url });
      if (alive.current) setLastInfo(res);
      return res;
    } catch (err) {
      if (alive.current) setFetchError(humanizeDlError(String(err)));
      return null;
    } finally {
      if (alive.current) setFetching(false);
    }
  }, []);

  const startDownload = useCallback(async (args: StartArgs): Promise<string | null> => {
    try {
      return await invoke<string>("dl_start", {
        args: {
          url: args.url,
          formatSelector: args.preset.formatSelector,
          kind: args.preset.kind,
          audioFormat: args.preset.audioFormat,
          container: args.preset.container,
          outputDir: args.outputDir,
          filename: args.filename,
          presetId: args.preset.id,
          title: args.title,
          thumbnail: args.thumbnail,
        },
      });
    } catch (err) {
      if (alive.current) setFetchError(humanizeDlError(String(err)));
      return null;
    }
  }, []);

  const cancelDownload = useCallback((taskId: string) => {
    void invoke("dl_cancel", { taskId }).catch(() => {});
  }, []);

  const retryDownload = useCallback(async (taskId: string): Promise<string | null> => {
    try {
      return await invoke<string>("dl_retry", { taskId });
    } catch (err) {
      if (alive.current) setFetchError(humanizeDlError(String(err)));
      return null;
    }
  }, []);

  const clearDone = useCallback(async () => {
    try {
      await invoke("dl_clear_done");
      const list = await invoke<DownloadTask[]>("dl_get_queue");
      if (alive.current) setTasks(new Map(list.map((t) => [t.id, t])));
    } catch {
      /* keep current */
    }
  }, []);

  const saveSettings = useCallback(async (next: DownloadSettings): Promise<boolean> => {
    try {
      await invoke("dl_set_settings", { newSettings: next });
      if (alive.current) setSettings(next);
      return true;
    } catch (err) {
      if (alive.current) setFetchError(humanizeDlError(String(err)));
      return false;
    }
  }, []);

  const openOutputDir = useCallback(() => {
    void invoke("dl_open_output_dir").catch(() => {});
  }, []);

  const updateYtdlp = useCallback(async (): Promise<string | null> => {
    try {
      return await invoke<string>("dl_update_ytdlp");
    } catch {
      return null;
    }
  }, []);

  return {
    tasks,
    binaryStatus,
    settings,
    fetching,
    fetchError,
    lastInfo,
    setLastInfo,
    fetchInfo,
    startDownload,
    cancelDownload,
    retryDownload,
    clearDone,
    saveSettings,
    openOutputDir,
    updateYtdlp,
  };
}

/** The full downloader API surface returned by `useDownloader()`. */
export type DownloaderApi = ReturnType<typeof useDownloader>;

function humanizeDlError(raw: string): string {
  if (raw.includes("premium_required")) return "Premium required.";
  if (raw.includes("fetch_info_timeout")) return "The site took too long to respond.";
  if (raw.includes("url_scheme_not_allowed") || raw.includes("url_invalid"))
    return "Please paste a valid http(s) link.";
  if (raw.includes("ytdlp_missing") || raw.includes("ffmpeg_missing"))
    return "Download engine not installed.";
  if (raw.includes("output_dir")) return "The chosen folder isn't usable. Pick another one.";
  if (raw.includes("filename_empty")) return "That filename isn't usable.";
  if (raw.includes("queue_full")) return "Too many active downloads -- clear some first.";
  if (raw.includes("disk_space_low")) return "Not enough free disk space (500 MB minimum).";
  if (raw.includes("retry_unavailable")) return "This download can't be retried.";
  if (raw.includes("fetch_info_failed"))
    return "Couldn't read that page. The site may be unsupported.";
  return "Something went wrong. Please try again.";
}
