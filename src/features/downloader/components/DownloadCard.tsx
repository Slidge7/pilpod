import type { DownloadTask } from "../types";

type Props = {
  task: DownloadTask;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenFile: (id: string) => void;
  onRetry: (task: DownloadTask) => void;
};

function statusLabel(task: DownloadTask): string {
  switch (task.status.type) {
    case "Queued":
      return "Queued";
    case "FetchingInfo":
      return "Fetching…";
    case "Downloading":
      return task.speed
        ? `${task.percent.toFixed(0)}% · ${task.speed}${task.eta ? ` · ${task.eta}` : ""}`
        : `${task.percent.toFixed(0)}%`;
    case "Muxing":
      return "Muxing…";
    case "Done":
      return "Done";
    case "Cancelled":
      return "Cancelled";
    case "Error":
      return "Error";
  }
}

function statusBadgeClass(task: DownloadTask): string {
  switch (task.status.type) {
    case "Done":
      return "pilpod-dl-card__badge--done";
    case "Error":
      return "pilpod-dl-card__badge--error";
    case "Cancelled":
      return "pilpod-dl-card__badge--muted";
    case "Downloading":
    case "Muxing":
      return "pilpod-dl-card__badge--active";
    default:
      return "";
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname.slice(0, 30) : "");
  } catch {
    return url.slice(0, 40);
  }
}

export function DownloadCard({ task, onCancel, onRemove, onOpenFile, onRetry }: Props) {
  const isActive =
    task.status.type === "Downloading" || task.status.type === "Muxing";
  const isDone = task.status.type === "Done";
  const isError = task.status.type === "Error";
  const isFinished = isDone || task.status.type === "Cancelled" || isError;
  const showProgress = isActive;

  const title = task.title ?? shortUrl(task.url);

  return (
    <li
      className={[
        "pilpod-dl-card",
        isActive ? "pilpod-dl-card--active" : "",
        isDone ? "pilpod-dl-card--done" : "",
        isError ? "pilpod-dl-card--error" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Thumbnail */}
      <div className="pilpod-dl-card__thumb">
        {task.thumbnail ? (
          <img
            src={task.thumbnail}
            alt=""
            width={48}
            height={27}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="pilpod-dl-card__thumb-placeholder" aria-hidden />
        )}
      </div>

      {/* Body */}
      <div className="pilpod-dl-card__body">
        <p className="pilpod-dl-card__title" title={title}>
          {title}
        </p>

        {/* Progress bar */}
        {showProgress && (
          <div className="pilpod-dl-card__progress-track" aria-hidden>
            <div
              className="pilpod-dl-card__progress-fill"
              style={{ width: `${task.percent}%` }}
            />
          </div>
        )}

        <div className="pilpod-dl-card__status-row">
          <span
            className={["pilpod-dl-card__badge", statusBadgeClass(task)]
              .filter(Boolean)
              .join(" ")}
          >
            {statusLabel(task)}
          </span>

          {isError && task.status.type === "Error" && (
            <span className="pilpod-dl-card__error-hint" title={task.status.data}>
              {task.status.data.slice(0, 60)}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="pilpod-dl-card__actions">
        {isActive && (
          <button
            type="button"
            className="pilpod-dl-card__btn"
            title="Cancel download"
            onClick={() => onCancel(task.id)}
          >
            ✕
          </button>
        )}
        {isDone && (
          <button
            type="button"
            className="pilpod-dl-card__btn pilpod-dl-card__btn--open"
            title="Open downloaded file"
            onClick={() => onOpenFile(task.id)}
          >
            Open
          </button>
        )}
        {isError && (
          <button
            type="button"
            className="pilpod-dl-card__btn"
            title="Retry download"
            onClick={() => onRetry(task)}
          >
            Retry
          </button>
        )}
        {isFinished && (
          <button
            type="button"
            className="pilpod-dl-card__btn pilpod-dl-card__btn--danger"
            title="Remove from list"
            onClick={() => onRemove(task.id)}
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}
