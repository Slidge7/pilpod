import "./SourceTabBar.css";
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
      className="pilpod-source-tab-bar"
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
        className={
          mainTab === "browser"
            ? "pilpod-source-tab-bar__tab pilpod-source-tab-bar__tab--active"
            : "pilpod-source-tab-bar__tab"
        }
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
        className={
          mainTab === "windows"
            ? "pilpod-source-tab-bar__tab pilpod-source-tab-bar__tab--active"
            : "pilpod-source-tab-bar__tab"
        }
      >
        Windows ({sessionCount})
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mainTab === "download"}
        id="tab-download"
        aria-controls="panel-download"
        onClick={() => onMainTabChange("download")}
        className={
          mainTab === "download"
            ? "pilpod-source-tab-bar__tab pilpod-source-tab-bar__tab--active"
            : "pilpod-source-tab-bar__tab"
        }
      >
        Download
      </button>
    </div>
  );
}
