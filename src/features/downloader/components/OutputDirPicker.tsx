import { IconFolderOpen } from "../../../shared/ui/icons";

type Props = {
  outputDir: string;
  onOpen: () => void;
};

/** Displays the current output directory with a button to open it in Explorer. */
export function OutputDirPicker({ outputDir, onOpen }: Props) {
  const short = outputDir
    ? outputDir.replace(/^.*[/\\]([^/\\]+[/\\][^/\\]*)$/, "…/$1")
    : "No folder selected";

  return (
    <div className="pilpod-dl-output">
      <span className="pilpod-dl-output__label" title={outputDir}>
        {short}
      </span>
      <button
        className="pilpod-dl-output__open"
        title="Open output folder in Explorer"
        aria-label="Open output folder"
        onClick={onOpen}
      >
        <IconFolderOpen className="pilpod-icon--sm" />
      </button>
    </div>
  );
}
