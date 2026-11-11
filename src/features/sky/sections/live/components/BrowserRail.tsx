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
    <nav className="sky-rail__section" aria-label="Browsers">
      <h2 className="sky-sidebar__heading">Browsers</h2>
      <ul className="sky-rail__list">
        <li>
          <button
            type="button"
            className="sky-rail__item"
            aria-current={selectedId === null ? "true" : undefined}
            onClick={() => onSelect(null)}
          >
            <span
              className="sky-browser-icon sky-browser-icon--all"
              aria-hidden="true"
            >
              ∗
            </span>
            <span className="sky-rail__text">
              <span className="sky-rail__name">All browsers</span>
              <span className="sky-rail__sub">
                {plural(stats.windows, "window")} · {plural(stats.tabs, "tab")}
              </span>
            </span>
            {stats.playing > 0 ? (
              <span
                className="sky-rail__playing"
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
              className="sky-rail__item"
              aria-current={selectedId === entry.id ? "true" : undefined}
              onClick={() =>
                onSelect(selectedId === entry.id ? null : entry.id)
              }
            >
              <BrowserIcon iconUrl={entry.iconUrl} label={entry.label} />
              <span className="sky-rail__text">
                <span className="sky-rail__name">
                  {entry.label}
                  {entry.browserName ? (
                    <span className="sky-rail__browser">
                      {" "}
                      · {entry.browserName}
                    </span>
                  ) : null}
                </span>
                <span className="sky-rail__sub">
                  {entry.status === "connected" || entry.tabs > 0
                    ? `${plural(entry.windows, "window")} · ${plural(entry.tabs, "tab")}`
                    : statusLabel(entry.status)}
                </span>
              </span>
              {entry.playing > 0 ? (
                <span
                  className="sky-rail__playing"
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
