import "./DevLabResults.css";
import type {
  DevBrowserTabScan,
  DevOsBrowserRow,
  DevWakeAndSyncResult,
} from "../hooks/useDevLabScans";
import { DevLabBrowserRow } from "./DevLabBrowserRow";

type Props = {
  browsers: DevOsBrowserRow[];
  browsersScannedAt: Date | null;
  browserTabScans: Record<string, DevBrowserTabScan>;
  wakeResults: Record<string, DevWakeAndSyncResult>;
  tabScanLoadingId: string | null;
  wakingBrowsers: Set<string>;
  onScanTabsForBrowser: (osBrowserId: string) => void;
  onWakeAndSyncBrowser: (osBrowserId: string) => void;
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function DevLabResults({
  browsers,
  browsersScannedAt,
  browserTabScans,
  wakeResults,
  tabScanLoadingId,
  wakingBrowsers,
  onScanTabsForBrowser,
  onWakeAndSyncBrowser,
}: Props) {
  const rawJson = {
    browsers,
    browserTabScans,
  };

  return (
    <div className="dev-lab-results">
      <section className="dev-lab-results__section">
        <h2 className="dev-lab-results__heading">
          {browsersScannedAt
            ? `Last browser scan · ${formatTime(browsersScannedAt)}`
            : "Browser scan"}
        </h2>
        {browsersScannedAt === null ? (
          <p className="dev-lab-results__empty">No scan yet.</p>
        ) : (
          <ul className="dev-lab-results__list">
            {[...browsers]
              .sort((a, b) => {
                if (a.installed !== b.installed) return a.installed ? -1 : 1;
                if (a.running !== b.running) return a.running ? -1 : 1;
                return a.displayName.localeCompare(b.displayName);
              })
              .map((browser) => (
                <DevLabBrowserRow
                  key={browser.id}
                  browser={browser}
                  tabScan={browserTabScans[browser.id]}
                  wakeResult={wakeResults[browser.id]}
                  scanning={tabScanLoadingId === browser.id}
                  waking={wakingBrowsers.has(browser.id)}
                  onScanTabs={() => onScanTabsForBrowser(browser.id)}
                  onWakeAndSync={() => onWakeAndSyncBrowser(browser.id)}
                />
              ))}
          </ul>
        )}
      </section>

      <details className="dev-lab-results__raw">
        <summary>Raw JSON</summary>
        <pre className="dev-lab-results__pre">
          {JSON.stringify(rawJson, null, 2)}
        </pre>
      </details>
    </div>
  );
}
