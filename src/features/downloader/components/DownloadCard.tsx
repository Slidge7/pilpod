import { statusLabel } from "../lib";
import type { DownloadTask } from "../types";

type Props = {
  task: DownloadTask;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenFolder: () => void;
};

export function DownloadCard({ task, onCancel, onRetry, onOpenFolder }: Props) {
  const kind = task.status.kind;
  const active = kind === "queued" || kind === "downloading" || kind === "muxing";
  const fillClass = [
    "pilpod-dl-task__fill",
    kind === "done" ? "pilpod-dl-task__fill--done" : "",
    kind === "error" ? "pilpod-dl-task__fill--error" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const width = kind === "done" ? 100 : kind === "muxing" ? 100 : task.percent;

  return (
    <div className="pilpod-dl-task">
      <div className="pilpod-dl-media">
        {task.thumbnail ? (
          <img className="pilpod-dl-media__thumb" src={task.thumbnail} alt="" aria-hidden />
        ) : null}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="pilpod-dl-media__title">{task.title ?? task.url}</div>
          <div className="pilpod-dl-hint" title={task.status.message ?? undefined}>
            {statusLabel(task)}
            {kind === "error" && task.status.message ? ` — ${task.status.message}` : ""}
          </div>
        </div>
        {active ? (
          <button
            type="button"
            className="pilpod-dl-btn pilpod-dl-btn--icon"
            onClick={() => onCancel(task.id)}
            aria-label="Cancel download"
          >
            Cancel
          </button>
        ) : kind === "done" ? (
          <button
            type="button"
            className="pilpod-dl-btn pilpod-dl-btn--icon"
            onClick={onOpenFolder}
            aria-label="Open folder"
          >
            Folder
          </button>
        ) : (
          <button
            type="button"
            className="pilpod-dl-btn pilpod-dl-btn--icon"
            onClick={() => onRetry(task.id)}
            aria-label="Retry download"
          >
            Retry
          </button>
        )}
      </div>
      <div className="pilpod-dl-task__bar" aria-hidden>
        <div className={fillClass} style={{ width: `${Math.min(100, Math.max(0, width))}%` }} />
      </div>
    </div>
  );
}
