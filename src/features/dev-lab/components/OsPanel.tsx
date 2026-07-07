import type { DevOsRow } from "../types";

type Props = {
  rows: DevOsRow[];
  busyIds: Set<string>;
  onWakeAndSync: (osBrowserId: string) => void;
  onClearExtInstalled: (osBrowserId: string) => void;
  onInjectStaleSlot: (osBrowserId: string) => void;
};

function stateBadgeClass(row: DevOsRow): string {
  if (!row.installed) return "dl-badge dl-badge--off";
  if (row.running) return "dl-badge dl-badge--ok";
  return "dl-badge dl-badge--idle";
}

/** OS truth: one row per catalog browser found installed or running. */
export function OsPanel({
  rows,
  busyIds,
  onWakeAndSync,
  onClearExtInstalled,
  onInjectStaleSlot,
}: Props) {
  return (
    <section className="dl-panel">
      <header className="dl-panel__head">
        <h2>OS browsers</h2>
        <span className="dl-panel__count">{rows.length}</span>
      </header>

      <div className="dl-panel__body">
        {rows.length === 0 ? (
          <p className="dl-empty">No scan yet — press Refresh.</p>
        ) : (
          rows.map((row) => (
            <article key={row.id} className="dl-row">
              <div className="dl-row__main">
                {row.iconUrl ? (
                  <img className="dl-row__icon" src={row.iconUrl} alt="" />
                ) : (
                  <span className="dl-row__icon dl-row__icon--blank" />
                )}
                <div className="dl-row__title">
                  <strong>{row.displayName}</strong>
                  <code className="dl-muted">{row.id}</code>
                </div>
                <span className={stateBadgeClass(row)}>
                  {row.processState}
                  {row.processCount > 0 ? ` ×${row.processCount}` : ""}
                </span>
              </div>

              <div className="dl-row__badges">
                <span
                  className={`dl-badge ${row.installed ? "dl-badge--ok" : "dl-badge--off"}`}
                >
                  {row.installed ? "installed" : "not installed"}
                </span>
                <span
                  className={`dl-badge ${row.extensionInstalledOs ? "dl-badge--ok" : "dl-badge--off"}`}
                >
                  ext on disk: {row.extensionInstalledOs ? "yes" : "no"}
                </span>
              </div>

              <div className="dl-row__actions">
                <button
                  type="button"
                  className="dl-btn"
                  disabled={busyIds.has(row.id)}
                  onClick={() => onWakeAndSync(row.id)}
                >
                  {busyIds.has(row.id) ? "Waking…" : "Wake & sync"}
                </button>
                <button
                  type="button"
                  className="dl-btn dl-btn--ghost"
                  onClick={() => onClearExtInstalled(row.id)}
                >
                  Clear ext flag
                </button>
                <button
                  type="button"
                  className="dl-btn dl-btn--ghost"
                  title="Simulate a dead extension reinstall UUID (tests slot GC)"
                  onClick={() => onInjectStaleSlot(row.id)}
                >
                  Inject stale
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
