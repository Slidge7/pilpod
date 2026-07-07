import { formatBytes } from "../lib";
import type { Preset } from "../types";

type Props = {
  presets: Preset[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function FormatPicker({ presets, selectedId, onSelect }: Props) {
  return (
    <div className="pilpod-dl-row">
      <span className="pilpod-dl-label">Format</span>
      <select
        className="pilpod-dl-select"
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Download format and quality"
      >
        {presets.map((p) => {
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
  );
}
