import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./DevLabApp.css";
import { LogPanel } from "./components/LogPanel";
import { OsPanel } from "./components/OsPanel";
import { SlotsPanel } from "./components/SlotsPanel";
import { useDevLabState } from "./hooks/useDevLabState";

/**
 * Dev Lab v2 — full-screen diagnostic surface.
 *
 * Three live panels side by side: OS truth, raw extension slots, and the
 * event log — plus the merged dashboard payload for truth-vs-view comparison.
 */
export function DevLabApp() {
  const {
    full,
    loading,
    log,
    busyIds,
    refreshFull,
    wakeAndSync,
    killWs,
    clearExtInstalled,
    clearIconCache,
    syncAll,
    mediaControl,
    injectStaleSlot,
    gcSlotsNow,
    simulateResume,
    clearLog,
  } = useDevLabState();

  const closeWindow = () => {
    void getCurrentWebviewWindow().close();
  };

  const generated = full
    ? new Date(full.generatedAtMs).toLocaleTimeString(undefined, {
        hour12: false,
      })
    : "—";

  return (
    <div className="dev-lab-shell" data-tauri-drag-region>
      <header className="dl-header" data-tauri-drag-region>
        <h1 data-tauri-drag-region>PilPod Dev Lab</h1>
        <span className="dl-muted">state @ {generated}</span>
        <div className="dl-header__actions">
          <button
            type="button"
            className="dl-btn"
            disabled={loading}
            onClick={() => void refreshFull()}
          >
            {loading ? "Scanning…" : "Refresh state"}
          </button>
          <button type="button" className="dl-btn" onClick={() => void syncAll()}>
            Sync all
          </button>
          <button
            type="button"
            className="dl-btn dl-btn--ghost"
            onClick={() => void clearIconCache()}
          >
            Clear icon cache
          </button>
          <button
            type="button"
            className="dl-btn dl-btn--ghost"
            title="Remove slots not seen for 15+ minutes"
            onClick={() => void gcSlotsNow()}
          >
            GC slots
          </button>
          <button
            type="button"
            className="dl-btn dl-btn--ghost"
            title="Mark all slots stale + reconnecting, like waking from sleep"
            onClick={() => void simulateResume()}
          >
            Simulate resume
          </button>
          <button
            type="button"
            className="dl-btn dl-btn--ghost"
            onClick={closeWindow}
          >
            Close
          </button>
        </div>
      </header>

      <main className="dl-grid">
        <OsPanel
          rows={full?.osRows ?? []}
          busyIds={busyIds}
          onWakeAndSync={(id) => void wakeAndSync(id)}
          onClearExtInstalled={(id) => void clearExtInstalled(id)}
          onInjectStaleSlot={(id) => void injectStaleSlot(id)}
        />
        <SlotsPanel
          slots={full?.slots ?? []}
          onKillWs={(id, subject) => void killWs(id, subject)}
          onMediaControl={(browserId, tabId, action, subject, value) =>
            void mediaControl(browserId, tabId, action, subject, value)
          }
        />
        <LogPanel log={log} onClear={clearLog} />
      </main>

      <footer className="dl-footer">
        <details>
          <summary>
            Merged dashboard payload ({full?.merged.browsers.length ?? 0} rows) —
            exactly what the main window receives
          </summary>
          <pre className="dl-json">
            {full ? JSON.stringify(full.merged, null, 2) : "no state yet"}
          </pre>
        </details>
      </footer>
    </div>
  );
}
