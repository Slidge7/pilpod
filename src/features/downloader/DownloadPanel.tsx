import { useEffect, useRef, useState } from "react";
import "./Downloader.css";
import { BinaryStatusBanner } from "./components/BinaryStatusBanner";
import { DownloadCard } from "./components/DownloadCard";
import { FormatPicker } from "./components/FormatPicker";
import { SaveOptions } from "./components/SaveOptions";
import { UrlInput } from "./components/UrlInput";
import { Spinner } from "../../shared/ui/icons";
import type { DownloaderApi } from "./hooks/useDownloader";
import { formatDuration, isTerminal, sortTasks } from "./lib";

type Props = {
  dl: DownloaderApi;
  seedUrl?: string | null;
  onSeedConsumed?: () => void;
};

/**
 * Premium downloader panel. Always rendered inside <PremiumGate>; the Rust
 * backend independently enforces entitlement on every command.
 */
export function DownloadPanel({ dl, seedUrl, onSeedConsumed }: Props) {
  const {
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
  } = dl;

  const [presetId, setPresetId] = useState<string>("best");
  const [outputDir, setOutputDir] = useState<string>("");
  const [filename, setFilename] = useState<string>("");

  // Adopt persisted defaults once settings hydrate.
  useEffect(() => {
    if (settings) {
      setOutputDir((d) => d || settings.outputDir);
      setPresetId((p) => (p === "best" ? settings.preferredPreset : p));
    }
  }, [settings]);

  // When a seed URL arrives (from an in-tab download button), auto-fetch info.
  const lastSeed = useRef<string | null>(null);
  useEffect(() => {
    if (seedUrl && seedUrl !== lastSeed.current) {
      lastSeed.current = seedUrl;
      void fetchInfo(seedUrl);
      onSeedConsumed?.();
    }
  }, [seedUrl, fetchInfo, onSeedConsumed]);

  const taskList = sortTasks(tasks);
  const hasTerminal = taskList.some(isTerminal);
  const info = lastInfo?.info ?? null;
  const presets = lastInfo?.presets ?? [];
  const selectedPreset = presets.find((p) => p.id === presetId) ?? presets[0] ?? null;

  // Show the card section when we have info OR when we're actively fetching.
  const showCard = !!info || fetching;

  const start = async () => {
    if (!info || !selectedPreset || !outputDir) return;
    const id = await startDownload({
      url: info.webpageUrl ?? "",
      preset: selectedPreset,
      outputDir,
      filename: filename.trim() === "" ? null : filename.trim(),
      title: info.title,
      thumbnail: info.thumbnail,
    });
    if (id) {
      // Persist chosen defaults for next time (best effort).
      if (settings && (outputDir !== settings.outputDir || selectedPreset.id !== settings.preferredPreset)) {
        void saveSettings({ ...settings, outputDir, preferredPreset: selectedPreset.id });
      }
      setLastInfo(null);
      setFilename("");
    }
  };

  return (
    <div className="pilpod-dl-panel">
      <BinaryStatusBanner status={binaryStatus} onUpdate={updateYtdlp} />

      <div className="pilpod-dl-card">
        <UrlInput fetching={fetching} onFetch={(url) => void fetchInfo(url)} />
        {fetchError && <div className="pilpod-dl-error">{fetchError}</div>}

        {showCard && (
          <>
            {/* Media preview — show real info when available, skeleton while fetching */}
            <div className="pilpod-dl-media">
              {info?.thumbnail ? (
                <img className="pilpod-dl-media__thumb" src={info.thumbnail} alt="" aria-hidden />
              ) : fetching ? (
                <div className="pilpod-dl-media__thumb pilpod-dl-media__thumb--skeleton" aria-hidden />
              ) : null}
              <div style={{ minWidth: 0 }}>
                <div className="pilpod-dl-media__title">
                  {info?.title ?? (fetching ? "Fetching media info…" : "")}
                </div>
                {info && formatDuration(info.duration) && (
                  <div className="pilpod-dl-hint">{formatDuration(info.duration)}</div>
                )}
              </div>
            </div>

            {/* Format picker — disabled while fetching */}
            <FormatPicker
              presets={presets}
              selectedId={selectedPreset?.id ?? "best"}
              onSelect={setPresetId}
              disabled={fetching}
            />

            {/* Save location + filename — always interactive */}
            <SaveOptions
              outputDir={outputDir}
              filename={filename}
              onOutputDirChange={setOutputDir}
              onFilenameChange={setFilename}
            />

            {/* Download button — spinner while fetching */}
            <button
              type="button"
              className="pilpod-dl-btn pilpod-dl-btn--primary"
              disabled={fetching || !selectedPreset || !outputDir || binaryStatus?.ok === false}
              onClick={() => void start()}
            >
              {fetching ? (
                <span className="pilpod-dl-btn__loading">
                  <Spinner />
                  <span>Fetching…</span>
                </span>
              ) : (
                "Download"
              )}
            </button>
          </>
        )}
      </div>

      {taskList.length > 0 && (
        <>
          <div className="pilpod-dl-row" style={{ justifyContent: "space-between" }}>
            <span className="pilpod-dl-label">Downloads</span>
            {hasTerminal && (
              <button
                type="button"
                className="pilpod-dl-hint-btn"
                onClick={clearDone}
              >
                Clear done
              </button>
            )}
          </div>
          <ul className="pilpod-dl-task-list">
            {taskList.map((task) => (
              <DownloadCard
                key={task.id}
                task={task}
                onCancel={cancelDownload}
                onRetry={retryDownload}
                onOpenFolder={openOutputDir}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
