import { useState } from "react";
import type { BinaryStatus } from "../types";

type Props = {
  status: BinaryStatus | null;
  onUpdate: () => Promise<string | null>;
};

/** Shown when the download engine (yt-dlp/ffmpeg) is missing or broken. */
export function BinaryStatusBanner({ status, onUpdate }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (status === null || status.ok) return null;

  return (
    <div className="pilpod-dl-banner" role="alert">
      <span style={{ flex: 1 }}>
        Download engine not available.
        {message ? ` ${message}` : " Try reinstalling or updating."}
      </span>
      <button
        type="button"
        className="pilpod-dl-btn pilpod-dl-btn--icon"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onUpdate()
            .then((s) => setMessage(s ?? "Update failed."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Working…" : "Repair"}
      </button>
    </div>
  );
}
