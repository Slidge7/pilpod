import type { BrowserRailEntry, OverviewStats } from "../types";
import { BrowserIcon, StatusBadge, statusLabel } from "../../../ui/StatusBadge";

type Props = {
  entries: BrowserRailEntry[];
  stats: OverviewStats;
  selectedId: string | null;
  onSelect: (browserId: string | null) => void;
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Every browser profile PilPod knows about; picking one narrows the page to it. */
export function BrowserRail({ entries, stats, selectedId, onSelect }: Props) {
  return (
    <nav className="gm-rail__section" aria-label="Browsers">
      <h2 className="gm-sidebar__heading">Browsers</h2>
      <ul className="gm-rail__list">
        <li>
          <button
            type="button"
            className="gm-rail__item"
            aria-current={selectedId === null ? "true" : undefined}
            onClick={() => onSelect(null)}
          >
            <span
              className="gm-browser-icon gm-browser-icon--all"
              aria-hidden="true"
            >
              ∗
            </span>
            <span className="gm-rail__text">
              <span className="gm-rail__name">All browsers</span>
              <span className="gm-rail__sub">
                {plural(stats.windows, "window")} · {plural(stats.tabs, "tab")}
              </span>
            </span>
            {stats.playing > 0 ? (
              <span
                className="gm-rail__playing"
                title={`${stats.playing} playing`}
              >
                ♪ {stats.playing}
              </span>
            ) : null}
          </button>
        </li>

        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="gm-rail__item"
              aria-current={selectedId === entry.id ? "true" : undefined}
              onClick={() =>
                onSelect(selectedId === entry.id ? null : entry.id)
              }
            >
              <BrowserIcon iconUrl={entry.iconUrl} label={entry.label} />
              <span className="gm-rail__text">
                <span className="gm-rail__name">
                  {entry.label}
                  {entry.browserName ? (
                    <span className="gm-rail__browser">
                      {" "}
                      · {entry.browserName}
                    </span>
                  ) : null}
                </span>
                <span className="gm-rail__sub">
                  {entry.status === "connected" || entry.tabs > 0
                    ? `${plural(entry.windows, "window")} · ${plural(entry.tabs, "tab")}`
                    : statusLabel(entry.status)}
                </span>
              </span>
              {entry.playing > 0 ? (
                <span
                  className="gm-rail__playing"
                  title={`${entry.playing} playing`}
                >
                  ♪ {entry.playing}
                </span>
              ) : null}
              <StatusBadge status={entry.status} compact />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
