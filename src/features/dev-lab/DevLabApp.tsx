import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./DevLabApp.css";
import { DevLabHeader } from "./components/DevLabHeader";
import { DevLabResults } from "./components/DevLabResults";
import { useDevLabScans } from "./hooks/useDevLabScans";

export function DevLabApp() {
  const {
    mediaSnapshot,
    mediaScannedAt,
    browsers,
    browsersScannedAt,
    browserTabScans,
    tabScanLoadingId,
    wakeResults,
    wakingBrowsers,
    loading,
    error,
    scanMedia,
    scanBrowsers,
    scanTabsForBrowser,
    wakeAndSyncBrowser,
  } = useDevLabScans();

  const closeWindow = () => {
    void getCurrentWebviewWindow().close();
  };

  return (
    <div className="dev-lab-shell">
      <div className="dev-lab-shell__inner">
        <DevLabHeader
          loadingMedia={loading === "media"}
          loadingBrowsers={loading === "browsers"}
          onScanMedia={scanMedia}
          onScanBrowsers={scanBrowsers}
          onClose={closeWindow}
        />

        <main className="dev-lab-shell__main">
          {error ? <div className="dev-lab-alert-error">{error}</div> : null}
          <DevLabResults
            mediaSnapshot={mediaSnapshot}
            mediaScannedAt={mediaScannedAt}
            browsers={browsers}
            browsersScannedAt={browsersScannedAt}
            browserTabScans={browserTabScans}
            wakeResults={wakeResults}
            tabScanLoadingId={tabScanLoadingId}
            wakingBrowsers={wakingBrowsers}
            onScanTabsForBrowser={scanTabsForBrowser}
            onWakeAndSyncBrowser={wakeAndSyncBrowser}
          />
        </main>
      </div>
    </div>
  );
}
