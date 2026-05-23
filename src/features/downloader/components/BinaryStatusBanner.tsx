import { useState } from "react";
import type { BinaryStatus } from "../types";

type Props = {
  status: BinaryStatus;
  onInstall: () => Promise<void>;
};

export function BinaryStatusBanner({ status, onInstall }: Props) {
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (status.ok || dismissed) return null;

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await onInstall();
    } finally {
      setInstalling(false);
    }
  };

  const missing = [
    !status.ytdlp_present && "yt-dlp",
    !status.ffmpeg_present && "FFmpeg",
  ]
    .filter(Boolean)
    .join(" & ");

  return (
    <div className="pilpod-dl-banner">
      <span className="pilpod-dl-banner__icon" aria-hidden>⚠</span>
      <p className="pilpod-dl-banner__text">
        {missing} not found. PilPod needs to download{" "}
        {!status.ytdlp_present && !status.ffmpeg_present ? "them" : "it"} once (~15 MB).
      </p>
      <div className="pilpod-dl-banner__actions">
        <button
          className="pilpod-dl-banner__btn pilpod-dl-banner__btn--primary"
          disabled={installing}
          onClick={handleInstall}
        >
          {installing ? "Updating…" : `Install ${missing}`}
        </button>
        <button
          className="pilpod-dl-banner__btn"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
