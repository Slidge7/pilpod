import type { OverviewStats, TabFilter } from "../types";

type Props = {
  stats: OverviewStats;
  filter: TabFilter;
  onFilter: (filter: TabFilter) => void;
};

/**
 * The totals across everything — and, for the tab counts, the filter itself:
 * clicking "Playing" shows the playing tabs. One row of controls instead of a
 * stats strip plus a separate segmented filter that repeats its numbers.
 */
export function StatsBar({ stats, filter, onFilter }: Props) {
  const filters: { id: TabFilter; label: string; value: number }[] = [
    { id: "all", label: "Tabs", value: stats.tabs },
    { id: "media", label: "Media", value: stats.media },
    { id: "playing", label: "Playing", value: stats.playing },
    { id: "audible", label: "With sound", value: stats.audible },
  ];

  return (
    <div className="sky-stats" role="toolbar" aria-label="Overview">
      <div className="sky-stat">
        <span className="sky-stat__value">
          {stats.connected}
          <small>/{stats.profiles}</small>
        </span>
        <span className="sky-stat__label">Browsers connected</span>
      </div>
      <div className="sky-stat">
        <span className="sky-stat__value">{stats.windows}</span>
        <span className="sky-stat__label">Windows</span>
      </div>

      <span className="sky-stats__divider" aria-hidden="true" />

      {filters.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`sky-stat sky-stat--filter sky-stat--${f.id}`}
          aria-pressed={filter === f.id}
          onClick={() => onFilter(f.id)}
          title={
            f.id === "all"
              ? "Show every tab"
              : `Show only: ${f.label.toLowerCase()}`
          }
        >
          <span className="sky-stat__value">{f.value}</span>
          <span className="sky-stat__label">{f.label}</span>
        </button>
      ))}
    </div>
  );
}
