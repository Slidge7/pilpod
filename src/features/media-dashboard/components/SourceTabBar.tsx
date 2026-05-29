import "./SourceTabBar.css";
import type { MediaMainTab } from "../model";
import { IconDownload, IconGlobe, IconMonitor } from "../../../shared/ui/icons";

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
        <IconGlobe className="pilpod-source-tab-bar__tab-icon" />
        <span className="pilpod-source-tab-bar__tab-label">
          Browsers ({browserTabCount})
        </span>
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
        <IconMonitor className="pilpod-source-tab-bar__tab-icon" />
        <span className="pilpod-source-tab-bar__tab-label">
          Windows ({sessionCount})
        </span>
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
        <IconDownload className="pilpod-source-tab-bar__tab-icon" />
        <span className="pilpod-source-tab-bar__tab-label">Download</span>
      </button>
    </div>
  );
}
