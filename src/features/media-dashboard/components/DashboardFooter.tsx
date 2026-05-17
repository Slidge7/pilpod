import type { AppearanceMode } from "../../../theme/appearance";
import {
  IconMoon,
  IconRefresh,
  IconSun,
  IconWidgetMinimize,
} from "./icons";

type Props = {
  appearance: AppearanceMode;
  widgetEnabled: boolean;
  onToggleAppearance: () => void;
  onRefresh: () => void;
  onToggleWidgetEnabled: () => void;
};

export function DashboardFooter({
  appearance,
  widgetEnabled,
  onToggleAppearance,
  onRefresh,
  onToggleWidgetEnabled,
}: Props) {
  const appearanceTitle =
    appearance === "dark" ? "Use light appearance" : "Use dark appearance";
  const widgetToggleTitle = widgetEnabled
    ? "Floating widget on minimize: on (click to turn off)"
    : "Floating widget on minimize: off (click to turn on)";

  return (
    <footer className="flex min-h-7 shrink-0 items-center justify-between gap-2 border-t border-zinc-200/90 bg-white/95 px-2 py-0.5 dark:border-zinc-800/90 dark:bg-zinc-950/95">
      <p className="min-w-0 truncate text-[10px] leading-tight text-zinc-500 dark:text-zinc-500">
        Provided by s7.ma
      </p>
      <div className="flex shrink-0 items-center gap-px">
        <button
          type="button"
          onClick={onToggleAppearance}
          className="flex h-7 min-w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title={appearanceTitle}
          aria-label={appearanceTitle}
        >
          {appearance === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="flex h-7 min-w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title="Refresh"
          aria-label="Refresh"
        >
          <IconRefresh />
        </button>
        <button
          type="button"
          onClick={onToggleWidgetEnabled}
          className={`flex h-7 min-w-7 items-center justify-center rounded-md transition-colors ${
            widgetEnabled
              ? "bg-amber-50 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-950/70 dark:text-amber-400 dark:ring-amber-700/50"
              : "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          }`}
          title={widgetToggleTitle}
          aria-label={widgetToggleTitle}
          aria-pressed={widgetEnabled}
        >
          <IconWidgetMinimize />
        </button>
      </div>
    </footer>
  );
}
