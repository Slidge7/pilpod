import type { MediaMainTab } from "../model";

type Props = {
  mainTab: MediaMainTab;
  onMainTabChange: (tab: MediaMainTab) => void;
  browserTabCount: number;
  sessionCount: number;
};

export function SourceTabBar({
  mainTab,
  onMainTabChange,
  browserTabCount,
  sessionCount,
}: Props) {
  return (
    <div
      className="flex shrink-0 gap-px border-b border-zinc-300 bg-zinc-50 px-0.5 py-0 dark:border-zinc-800 dark:bg-zinc-900"
      data-tauri-drag-region="deep"
      role="tablist"
      aria-label="Media source"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mainTab === "browser"}
        id="tab-browser"
        aria-controls="panel-browser"
        onClick={() => onMainTabChange("browser")}
        className={`flex-1 rounded-none border border-transparent px-2 py-1.5 text-[11px] font-semibold transition-colors ${
          mainTab === "browser"
            ? "border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-300"
        }`}
      >
        Browsers ({browserTabCount})
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mainTab === "windows"}
        id="tab-windows"
        aria-controls="panel-windows"
        onClick={() => onMainTabChange("windows")}
        className={`flex-1 rounded-none border border-transparent px-2 py-1.5 text-[11px] font-semibold transition-colors ${
          mainTab === "windows"
            ? "border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-300"
        }`}
      >
        Windows ({sessionCount})
      </button>
    </div>
  );
}
