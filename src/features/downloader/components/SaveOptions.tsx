import { open } from "@tauri-apps/plugin-dialog";
import { previewFilename } from "../lib";

type Props = {
  outputDir: string;
  filename: string;
  onOutputDirChange: (dir: string) => void;
  onFilenameChange: (name: string) => void;
};

export function SaveOptions({ outputDir, filename, onOutputDirChange, onFilenameChange }: Props) {
  const pickDir = async () => {
    const dir = await open({ directory: true, defaultPath: outputDir || undefined });
    if (typeof dir === "string" && dir) onOutputDirChange(dir);
  };

  const preview = previewFilename(filename);
  const changed = filename.trim() !== "" && preview !== filename.trim();

  return (
    <>
      <div className="pilpod-dl-row">
        <span className="pilpod-dl-label">Save to</span>
        <span className="pilpod-dl-hint" title={outputDir}>
          {outputDir || "—"}
        </span>
        <button type="button" className="pilpod-dl-btn pilpod-dl-btn--icon" onClick={() => void pickDir()}>
          Browse…
        </button>
      </div>
      <div className="pilpod-dl-row">
        <span className="pilpod-dl-label">Name</span>
        <input
          className="pilpod-dl-input"
          type="text"
          value={filename}
          onChange={(e) => onFilenameChange(e.target.value)}
          placeholder="Video title (default)"
          spellCheck={false}
          autoComplete="off"
          aria-label="Custom filename"
        />
      </div>
      {changed && preview && (
        <div className="pilpod-dl-hint">Will be saved as: {preview}</div>
      )}
    </>
  );
}
