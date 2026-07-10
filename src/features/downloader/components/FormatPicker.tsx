import { useEffect, useState } from "react";
import { formatBytes } from "../lib";
import type { Preset } from "../types";

type Props = {
  presets: Preset[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
};

export function FormatPicker({ presets, selectedId, onSelect, disabled }: Props) {
  const [kind, setKind] = useState<"video" | "audio">("video");

  useEffect(() => {
    const sel = presets.find(p => p.id === selectedId);
    if (sel && sel.kind !== kind) {
      setKind(sel.kind);
    }
  }, [selectedId, presets, kind]);

  const handleKindChange = (newKind: "video" | "audio") => {
    setKind(newKind);
    const newPresets = presets.filter(p => p.kind === newKind);
    if (newPresets.length > 0) {
      onSelect(newPresets[0].id);
    }
  };

  const filteredPresets = presets.filter(p => p.kind === kind);

  return (
    <>
      <div className="pilpod-dl-row">
        <span className="pilpod-dl-label">Type</span>
        <div className="pilpod-dl-radio-group">
          <label className="pilpod-dl-radio">
            <input 
              type="radio" 
              name="format-kind" 
              value="video" 
              checked={kind === "video"} 
              onChange={() => handleKindChange("video")} 
              disabled={disabled}
            />
            Video
          </label>
          <label className="pilpod-dl-radio">
            <input 
              type="radio" 
              name="format-kind" 
              value="audio" 
              checked={kind === "audio"} 
              onChange={() => handleKindChange("audio")} 
              disabled={disabled}
            />
            Audio
          </label>
        </div>
      </div>
      <div className="pilpod-dl-row">
        <span className="pilpod-dl-label">Format</span>
        <select
          className="pilpod-dl-select"
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="Download format and quality"
          disabled={disabled}
        >
          {filteredPresets.length === 0 && (
            <option value="" disabled>Loading formats…</option>
          )}
          {filteredPresets.map((p) => {
            const size = formatBytes(p.filesizeHint);
            return (
              <option key={p.id} value={p.id}>
                {p.label}
                {size ? ` (~${size})` : ""}
              </option>
            );
          })}
        </select>
      </div>
    </>
  );
}
