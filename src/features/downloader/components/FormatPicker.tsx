import type { FormatPreset, VideoInfoWithPresets } from "../types";

type Props = {
  info: VideoInfoWithPresets;
  selectedPreset: FormatPreset | null;
  onSelectPreset: (preset: FormatPreset) => void;
  onDownload: () => void;
  onCancel: () => void;
};

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function FormatPicker({ info, selectedPreset, onSelectPreset, onDownload, onCancel }: Props) {
  return (
    <div className="pilpod-dl-format-picker">
      {/* Video meta row */}
      <div className="pilpod-dl-format-picker__meta">
        {info.thumbnail && (
          <img
            className="pilpod-dl-format-picker__thumb"
            src={info.thumbnail}
            alt=""
            width={64}
            height={36}
            loading="lazy"
            decoding="async"
          />
        )}
        <div className="pilpod-dl-format-picker__meta-text">
          <p className="pilpod-dl-format-picker__title" title={info.title}>
            {info.title}
          </p>
          {info.duration != null && (
            <p className="pilpod-dl-format-picker__duration">
              {formatDuration(info.duration)}
            </p>
          )}
        </div>
      </div>

      {/* Preset selector */}
      <div className="pilpod-dl-format-picker__row">
        <select
          className="pilpod-dl-format-picker__select"
          value={selectedPreset?.format_id ?? ""}
          onChange={(e) => {
            const preset = info.presets.find((p) => p.format_id === e.target.value);
            if (preset) onSelectPreset(preset);
          }}
          aria-label="Quality preset"
        >
          {info.presets.map((p) => (
            <option key={p.format_id} value={p.format_id}>
              {p.label}
            </option>
          ))}
        </select>

        <button
          className="pilpod-dl-format-picker__dl-btn"
          disabled={!selectedPreset}
          onClick={onDownload}
        >
          Download
        </button>
      </div>

      <button className="pilpod-dl-format-picker__cancel" onClick={onCancel}>
        ✕ Clear
      </button>
    </div>
  );
}
