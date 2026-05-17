import {
  IconClose,
  IconMinimize,
  IconStayOnTop,
} from "./icons";

type Props = {
  browserTabCount: number;
  sessionCount: number;
  alwaysOnTop: boolean;
  widgetEnabled: boolean;
  onToggleAlwaysOnTop: () => void;
  onMinimize: () => void;
  onClose: () => void;
};

export function DashboardHeader({
  browserTabCount,
  sessionCount,
  alwaysOnTop,
  widgetEnabled,
  onToggleAlwaysOnTop,
  onMinimize,
  onClose,
}: Props) {
  const minimizeTitle = widgetEnabled
    ? "Minimize to floating widget"
    : "Minimize to taskbar";

  return (
    <header
      className="flex min-h-8 shrink-0 items-stretch border-b border-zinc-200/90 bg-white/95 dark:border-zinc-800/90 dark:bg-zinc-950/95"
      data-tauri-drag-region="deep"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
        <img
          src="/pilpod-icon.png"
          alt=""
          width={22}
          height={22}
          className="pointer-events-none size-[22px] shrink-0 rounded-md object-cover shadow-sm ring-1 ring-zinc-200/70 dark:ring-zinc-700/70"
          aria-hidden
        />
        <span className="truncate text-[11px] font-medium tracking-tight text-zinc-700 dark:text-zinc-300">
          PilPod
        </span>
        <span className="truncate text-[10px] text-zinc-400 dark:text-zinc-600">
          {browserTabCount} br · {sessionCount} win
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-px pr-1">
        <button
          type="button"
          onClick={onToggleAlwaysOnTop}
          className={`flex h-8 min-w-8 items-center justify-center rounded-md transition-colors ${
            alwaysOnTop
              ? "bg-amber-50 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-950/70 dark:text-amber-400 dark:ring-amber-700/50"
              : "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          }`}
          title={alwaysOnTop ? "Disable always on top" : "Keep window on top"}
          aria-pressed={alwaysOnTop}
        >
          <IconStayOnTop />
        </button>
        <button
          type="button"
          onClick={onMinimize}
          className="flex h-8 min-w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title={minimizeTitle}
          aria-label={minimizeTitle}
        >
          <IconMinimize />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 min-w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-zinc-500 dark:hover:bg-red-950/60 dark:hover:text-red-300"
          title="Close"
        >
          <IconClose />
        </button>
      </div>
    </header>
  );
}
