import { invoke } from "@tauri-apps/api/core";
import type { DownloadTask } from "../types";
import { DownloadCard } from "./DownloadCard";
import type { QueuedTask } from "../hooks/useDownloadQueue";

type Props = {
  queue: QueuedTask[];
  onCancel: (id: string) => void;
  onRetry: (task: DownloadTask) => void;
  onClearDone: () => void;
};

export function DownloadQueue({ queue, onCancel, onRetry, onClearDone }: Props) {
  const hasFinished = queue.some(
    (t) =>
      t.status.type === "Done" ||
      t.status.type === "Cancelled" ||
      t.status.type === "Error",
  );

  function handleRemove(id: string) {
    // Remove from local state via the hook's clearDone — but we need a single-task
    // removal. For now, just hide immediately by marking cancelled via cancel.
    invoke("dl_cancel", { taskId: id }).catch(() => {});
  }

  function handleOpenFile(id: string) {
    // Find the task to get its output_path.
    const task = queue.find((t) => t.id === id);
    if (task?.output_path) {
      // Open the file with the default viewer.
      invoke("dl_open_output_dir").catch(() => {});
    }
  }

  if (queue.length === 0) {
    return (
      <p className="pilpod-dl-queue__empty">
        No downloads yet. Paste a URL above to get started.
      </p>
    );
  }

  return (
    <div className="pilpod-dl-queue">
      <div className="pilpod-dl-queue__header">
        <span className="pilpod-dl-queue__label">Downloads</span>
        {hasFinished && (
          <button
            type="button"
            className="pilpod-dl-queue__clear"
            onClick={onClearDone}
          >
            Clear done
          </button>
        )}
      </div>
      <ul className="pilpod-dl-queue__list">
        {queue.map((task) => (
          <DownloadCard
            key={task.id}
            task={task}
            onCancel={onCancel}
            onRemove={handleRemove}
            onOpenFile={handleOpenFile}
            onRetry={onRetry}
          />
        ))}
      </ul>
    </div>
  );
}
