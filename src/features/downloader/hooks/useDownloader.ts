import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  BinaryStatus,
  CompletePayload,
  DownloadTask,
  ErrorPayload,
  FormatPreset,
  ProgressPayload,
  VideoInfoWithPresets,
} from "../types";

export type DownloaderState = {
  tasks: Map<string, DownloadTask>;
  binaryStatus: BinaryStatus | null;
  fetchingInfo: boolean;
  fetchInfoError: string | null;
  videoInfo: VideoInfoWithPresets | null;
  selectedPreset: FormatPreset | null;
  outputDir: string;
};

export type UseDownloaderReturn = DownloaderState & DownloaderActions;

export type DownloaderActions = {
  fetchInfo: (url: string) => Promise<void>;
  clearFetchedInfo: () => void;
  selectPreset: (preset: FormatPreset) => void;
  startDownload: (url: string, preset: FormatPreset) => Promise<string | null>;
  cancelDownload: (id: string) => Promise<void>;
  clearDone: () => void;
  setOutputDir: (path: string) => Promise<void>;
  openOutputDir: () => Promise<void>;
  checkBinaries: () => Promise<void>;
  installYtdlp: () => Promise<void>;
};

export function useDownloader(): UseDownloaderReturn {
  const [tasks, setTasks] = useState<Map<string, DownloadTask>>(() => new Map());
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatus | null>(null);
  const [fetchingInfo, setFetchingInfo] = useState(false);
  const [fetchInfoError, setFetchInfoError] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfoWithPresets | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<FormatPreset | null>(null);
  const [outputDir, setOutputDirState] = useState("");

  // Keep a ref to the tasks map to avoid stale closures in event handlers.
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // ── Mount: hydrate from Rust state ─────────────────────────────────────────

  useEffect(() => {
    invoke<DownloadTask[]>("dl_get_queue").then((queue) => {
      setTasks((prev) => {
        const next = new Map(prev);
        queue.forEach((t) => next.set(t.id, t));
        return next;
      });
    }).catch(() => {});

    invoke<string>("dl_get_output_dir").then(setOutputDirState).catch(() => {});

    invoke<BinaryStatus>("dl_check_binaries").then(setBinaryStatus).catch(() => {});
  }, []);

  // ── Event listeners ─────────────────────────────────────────────────────────

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    // Full task snapshot update (status change, title, thumbnail).
    listen<DownloadTask>("dl://update", (event) => {
      setTasks((prev) => {
        const next = new Map(prev);
        next.set(event.payload.id, event.payload);
        return next;
      });
    }).then((u) => unlisteners.push(u));

    // Lightweight progress tick.
    listen<ProgressPayload>("dl://progress", (event) => {
      const { id, percent, speed, eta } = event.payload;
      setTasks((prev) => {
        const existing = prev.get(id);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(id, { ...existing, percent, speed, eta });
        return next;
      });
    }).then((u) => unlisteners.push(u));

    // Download complete.
    listen<CompletePayload>("dl://complete", (event) => {
      const { id, output_path } = event.payload;
      setTasks((prev) => {
        const existing = prev.get(id);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(id, {
          ...existing,
          status: { type: "Done" },
          percent: 100,
          output_path,
        });
        return next;
      });
    }).then((u) => unlisteners.push(u));

    // Download error.
    listen<ErrorPayload>("dl://error", (event) => {
      const { id, message } = event.payload;
      setTasks((prev) => {
        const existing = prev.get(id);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(id, {
          ...existing,
          status: { type: "Error", data: message },
        });
        return next;
      });
    }).then((u) => unlisteners.push(u));

    // Binary status update.
    listen<BinaryStatus>("dl://binary-status", (event) => {
      setBinaryStatus(event.payload);
    }).then((u) => unlisteners.push(u));

    return () => {
      unlisteners.forEach((u) => u());
    };
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const fetchInfo = useCallback(async (url: string) => {
    setFetchingInfo(true);
    setFetchInfoError(null);
    setVideoInfo(null);
    setSelectedPreset(null);
    try {
      const info = await invoke<VideoInfoWithPresets>("dl_fetch_info", { url });
      setVideoInfo(info);
      if (info.presets.length > 0) {
        setSelectedPreset(info.presets[0]);
      }
    } catch (e) {
      setFetchInfoError(String(e));
    } finally {
      setFetchingInfo(false);
    }
  }, []);

  const clearFetchedInfo = useCallback(() => {
    setVideoInfo(null);
    setSelectedPreset(null);
    setFetchInfoError(null);
  }, []);

  const selectPreset = useCallback((preset: FormatPreset) => {
    setSelectedPreset(preset);
  }, []);

  const startDownload = useCallback(
    async (url: string, preset: FormatPreset): Promise<string | null> => {
      try {
        const taskId = await invoke<string>("dl_start", {
          url,
          formatId: preset.format_id,
          audioOnly: preset.audio_only,
          audioFormat: preset.audio_format,
        });
        return taskId;
      } catch (e) {
        console.error("dl_start error:", e);
        return null;
      }
    },
    [],
  );

  const cancelDownload = useCallback(async (id: string) => {
    await invoke("dl_cancel", { taskId: id }).catch(console.error);
  }, []);

  const clearDone = useCallback(() => {
    invoke("dl_clear_done").catch(console.error);
    setTasks((prev) => {
      const next = new Map(prev);
      for (const [id, task] of next) {
        const s = task.status.type;
        if (s === "Done" || s === "Cancelled" || s === "Error") {
          next.delete(id);
        }
      }
      return next;
    });
  }, []);

  const setOutputDir = useCallback(async (path: string) => {
    await invoke("dl_set_output_dir", { path });
    setOutputDirState(path);
  }, []);

  const openOutputDir = useCallback(async () => {
    await invoke("dl_open_output_dir").catch(console.error);
  }, []);

  const checkBinaries = useCallback(async () => {
    const status = await invoke<BinaryStatus>("dl_check_binaries");
    setBinaryStatus(status);
  }, []);

  const installYtdlp = useCallback(async () => {
    await invoke("dl_update_ytdlp");
    await checkBinaries();
  }, [checkBinaries]);

  return {
    tasks,
    binaryStatus,
    fetchingInfo,
    fetchInfoError,
    videoInfo,
    selectedPreset,
    outputDir,
    fetchInfo,
    clearFetchedInfo,
    selectPreset,
    startDownload,
    cancelDownload,
    clearDone,
    setOutputDir,
    openOutputDir,
    checkBinaries,
    installYtdlp,
  };
}
