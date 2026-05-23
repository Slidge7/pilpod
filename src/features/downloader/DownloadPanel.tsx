import "./DownloadPanel.css";
import { useCallback } from "react";
import { useDownloader } from "./hooks/useDownloader";
import { useDownloadQueue } from "./hooks/useDownloadQueue";
import { BinaryStatusBanner } from "./components/BinaryStatusBanner";
import { UrlInput } from "./components/UrlInput";
import { FormatPicker } from "./components/FormatPicker";
import { OutputDirPicker } from "./components/OutputDirPicker";
import { DownloadQueue } from "./components/DownloadQueue";
import type { DownloadTask } from "./types";

export function DownloadPanel() {
  const {
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
    openOutputDir,
    installYtdlp,
  } = useDownloader();

  const queue = useDownloadQueue(tasks);

  const handleDownload = useCallback(async () => {
    if (!videoInfo || !selectedPreset) return;
    await startDownload(videoInfo.webpage_url, selectedPreset);
    clearFetchedInfo();
  }, [videoInfo, selectedPreset, startDownload, clearFetchedInfo]);

  const handleRetry = useCallback(
    async (task: DownloadTask) => {
      const defaultPreset = {
        label: "Best quality (auto)",
        format_id: task.format_id ?? "bestvideo+bestaudio/best",
        audio_only: false,
        audio_format: null,
      };
      await startDownload(task.url, defaultPreset);
    },
    [startDownload],
  );

  return (
    <section
      role="tabpanel"
      id="panel-download"
      aria-labelledby="tab-download"
      className="pilpod-dl-panel"
    >
      {binaryStatus && !binaryStatus.ok && (
        <BinaryStatusBanner status={binaryStatus} onInstall={installYtdlp} />
      )}

      <div className="pilpod-dl-panel__top">
        <UrlInput loading={fetchingInfo} onFetch={fetchInfo} />

        {fetchInfoError && (
          <p className="pilpod-dl-panel__fetch-error">{fetchInfoError}</p>
        )}

        {videoInfo && (
          <FormatPicker
            info={videoInfo}
            selectedPreset={selectedPreset}
            onSelectPreset={selectPreset}
            onDownload={handleDownload}
            onCancel={clearFetchedInfo}
          />
        )}

        <OutputDirPicker outputDir={outputDir} onOpen={openOutputDir} />
      </div>

      <DownloadQueue
        queue={queue}
        onCancel={cancelDownload}
        onRetry={handleRetry}
        onClearDone={clearDone}
      />
    </section>
  );
}
