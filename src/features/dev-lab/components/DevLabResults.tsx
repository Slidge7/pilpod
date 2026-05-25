import "./DevLabResults.css";
import type { GsmtcSnapshot } from "../../../types/media";
import type {
  DevBrowserTabScan,
  DevOsBrowserRow,
  DevWakeAndSyncResult,
} from "../hooks/useDevLabScans";
import { DevLabBrowserRow } from "./DevLabBrowserRow";

type Props = {
  mediaSnapshot: GsmtcSnapshot | null;
  mediaScannedAt: Date | null;
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
  mediaSnapshot,
  mediaScannedAt,
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
    media: mediaSnapshot,
    browsers,
    browserTabScans,
  };

  return (
    <div className="dev-lab-results">
      <section className="dev-lab-results__section">
        <h2 className="dev-lab-results__heading">
          {mediaScannedAt
            ? `Last media scan · ${formatTime(mediaScannedAt)}`
            : "Media scan"}
        </h2>
        {mediaSnapshot === null ? (
          <p className="dev-lab-results__empty">No scan yet.</p>
        ) : mediaSnapshot.sessions.length === 0 ? (
          <p className="dev-lab-results__empty">No GSMTC sessions found.</p>
        ) : (
          <ul className="dev-lab-results__list">
            {mediaSnapshot.sessions.map((session) => (
              <li key={session.sourceAppUserModelId} className="dev-lab-results__item">
                <span className="dev-lab-results__item-title">
                  {session.title || session.sourceAppUserModelId}
                </span>
                {session.artist ? (
                  <span className="dev-lab-results__item-meta">
                    {" "}
                    — {session.artist}
                  </span>
                ) : null}
                <span className="dev-lab-results__item-status">
                  {" "}
                  ({session.playbackStatus})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dev-lab-results__section">
        <h2 className="dev-lab-results__heading">
          {browsersScannedAt
            ? `Last browser scan · ${formatTime(browsersScannedAt)}`
            : "Browser scan"}
        </h2>
        {browsersScannedAt === null ? (
          <p className="dev-lab-results__empty">No scan yet.</p>
        ) : browsers.length === 0 ? (
          <p className="dev-lab-results__empty">No browsers detected on this PC.</p>
        ) : (
          <ul className="dev-lab-results__list">
            {browsers.map((browser) => (
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
