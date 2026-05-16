import type { AppearanceMode } from "../../../theme/appearance";
import {
  IconClose,
  IconMoon,
  IconRefresh,
  IconStayOnTop,
  IconSun,
  IconWidgetMinimize,
} from "./icons";

type Props = {
  appearance: AppearanceMode;
  browserTabCount: number;
  sessionCount: number;
  alwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  onToggleAppearance: () => void;
  onRefresh: () => void;
  onMinimizeToWidget: () => void;
  onClose: () => void;
};

export function DashboardHeader({
  appearance,
  browserTabCount,
  sessionCount,
  alwaysOnTop,
  onToggleAlwaysOnTop,
  onToggleAppearance,
  onRefresh,
  onMinimizeToWidget,
  onClose,
}: Props) {
  const appearanceTitle =
    appearance === "dark" ? "Use light appearance" : "Use dark appearance";

  return (
    <header
      className="flex min-h-8 shrink-0 items-stretch border-b border-zinc-200/90 bg-white/95 dark:border-zinc-800/90 dark:bg-zinc-950/95"
      data-tauri-drag-region="deep"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
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
          onClick={onToggleAppearance}
          className="flex h-8 min-w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title={appearanceTitle}
          aria-label={appearanceTitle}
        >
          {appearance === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="flex h-8 min-w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title="Refresh"
        >
          <IconRefresh />
        </button>
        <button
          type="button"
          onClick={() => void onMinimizeToWidget()}
          className="flex h-8 min-w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title="Minimize to floating widget"
        >
          <IconWidgetMinimize />
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
