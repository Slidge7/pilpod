import { useState } from "react";
import "./DownloadDockCard.css";
import { sortTasksTerminalFirst, statusLabel, isTerminal } from "../lib";
import type { DownloadTask } from "../types";
import { IconChevronDown } from "../../../shared/ui/icons";

type Props = {
  tasks: ReadonlyMap<string, DownloadTask>;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenFolder: () => void;
  onClear: () => void;
};

export function DownloadDockCard({
  tasks,
  onCancel,
  onRetry,
  onOpenFolder,
  onClear,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const sorted = sortTasksTerminalFirst(tasks);

  if (sorted.length === 0) return null;

  const doneCount = sorted.filter((t) => t.status.kind === "done").length;
  const activeCount = sorted.filter(
    (t) =>
      t.status.kind === "queued" ||
      t.status.kind === "downloading" ||
      t.status.kind === "muxing",
  ).length;
  const hasTerminal = sorted.some(isTerminal);

  const summaryParts: string[] = [];
  if (doneCount > 0) summaryParts.push(`${doneCount} done`);
  if (activeCount > 0) summaryParts.push(`${activeCount} active`);
  const summaryText = summaryParts.length > 0 ? summaryParts.join(" · ") : "Downloads";

  return (
    <div className="pilpod-dl-dock-card">
      <button
        type="button"
        className="pilpod-dl-dock-card__header"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className="pilpod-dl-dock-card__summary">⤓ {summaryText}</span>
        <IconChevronDown
          className={`pilpod-dl-dock-card__chevron${collapsed ? "" : " pilpod-dl-dock-card__chevron--open"}`}
        />
      </button>

      {!collapsed && (
        <div className="pilpod-dl-dock-card__body">
          {sorted.map((task) => (
            <DockTaskRow
              key={task.id}
              task={task}
              onCancel={onCancel}
              onRetry={onRetry}
              onOpenFolder={onOpenFolder}
            />
          ))}
          {hasTerminal && (
            <button
              type="button"
              className="pilpod-dl-dock-card__clear"
              onClick={onClear}
            >
              Clear finished
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DockTaskRow({
  task,
  onCancel,
  onRetry,
  onOpenFolder,
}: {
  task: DownloadTask;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenFolder: () => void;
}) {
  const kind = task.status.kind;
  const active =
    kind === "queued" || kind === "downloading" || kind === "muxing";
  const fillWidth =
    kind === "done" ? 100 : kind === "muxing" ? 100 : task.percent;

  const fillClass = [
    "pilpod-dl-dock-card__fill",
    kind === "done" ? "pilpod-dl-dock-card__fill--done" : "",
    kind === "error" ? "pilpod-dl-dock-card__fill--error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="pilpod-dl-dock-card__row">
      {task.thumbnail ? (
        <img
          className="pilpod-dl-dock-card__thumb"
          src={task.thumbnail}
          alt=""
          aria-hidden
        />
      ) : (
        <span className="pilpod-dl-dock-card__thumb-placeholder" aria-hidden />
      )}
      <div className="pilpod-dl-dock-card__info">
        <span className="pilpod-dl-dock-card__title">
          {task.title ?? task.url}
        </span>
        <span className="pilpod-dl-dock-card__status">{statusLabel(task)}</span>
        <div className="pilpod-dl-dock-card__bar" aria-hidden>
          <div
            className={fillClass}
            style={{
              width: `${Math.min(100, Math.max(0, fillWidth))}%`,
            }}
          />
        </div>
      </div>
      <div className="pilpod-dl-dock-card__action">
        {active ? (
          <button
            type="button"
            className="pilpod-dl-dock-card__action-btn"
            onClick={() => onCancel(task.id)}
            title="Cancel"
            aria-label="Cancel download"
          >
            ×
          </button>
        ) : kind === "done" ? (
          <button
            type="button"
            className="pilpod-dl-dock-card__action-btn"
            onClick={onOpenFolder}
            title="Open folder"
            aria-label="Open folder"
          >
            📂
          </button>
        ) : kind === "error" ? (
          <button
            type="button"
            className="pilpod-dl-dock-card__action-btn"
            onClick={() => onRetry(task.id)}
            title="Retry"
            aria-label="Retry download"
          >
            ↻
          </button>
        ) : null}
      </div>
    </div>
  );
}
