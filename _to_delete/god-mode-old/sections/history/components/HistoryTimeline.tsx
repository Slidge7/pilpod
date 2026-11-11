import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { groupByDay, type HistoryListApi } from "../../../../history";
import { ConfirmButton } from "../../../ui/ConfirmButton";
import { plural } from "../../../ui/format";

type Props<T> = {
  list: HistoryListApi<T>;
  noun: string;
  renderRow: (item: T) => ReactNode;
  empty: ReactNode;
};

/**
 * Day-grouped, infinitely scrolling history. Each day is its own block with a
 * sticky heading; blocks off screen skip layout and paint
 * (`content-visibility`), which keeps long histories smooth.
 */
export function HistoryTimeline<T extends { id: number; startedAtMs: number }>({
  list,
  noun,
  renderRow,
  empty,
}: Props<T>) {
  const groups = useMemo(() => groupByDay(list.items, Date.now()), [list.items]);
  const sentinel = useLoadMoreOnVisible(list.hasMore, list.items.length, list.loadMore);

  if (list.loading && list.items.length === 0) {
    return (
      <div className="gm-timeline" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="gm-skeleton gm-skeleton--row" />
        ))}
      </div>
    );
  }
  if (list.items.length === 0) {
    return list.error ? <p className="gm-inline-error">{list.error}</p> : <>{empty}</>;
  }

  return (
    <div className="gm-timeline">
      {groups.map((group) => (
        <section key={group.key} className="gm-day" aria-label={group.label}>
          <header className="gm-day__head">
            <h3>{group.label}</h3>
            <span className="gm-day__count">{plural(group.items.length, noun)}{list.hasMore && group === groups[groups.length - 1] ? "+" : ""}</span>
            <ConfirmButton
              className="gm-textbtn gm-textbtn--danger"
              confirmLabel="Remove the whole day?"
              title={`Remove everything from ${group.label}`}
              onConfirm={() => void list.clearRange(group.startMs, group.endMs)}
            >
              Remove day
            </ConfirmButton>
          </header>
          <ul className="gm-day__rows">{group.items.map(renderRow)}</ul>
        </section>
      ))}
      {list.error ? <p className="gm-inline-error">{list.error}</p> : null}
      {list.hasMore ? (
        <div ref={sentinel} className="gm-timeline__more">
          <button type="button" className="gm-btn gm-btn--ghost" disabled={list.loadingMore} onClick={list.loadMore}>
            {list.loadingMore ? "Loading…" : "Show older"}
          </button>
        </div>
      ) : (
        <p className="gm-timeline__end">That is everything PilPod has kept.</p>
      )}
    </div>
  );
}

/**
 * Call `loadMore` whenever the sentinel scrolls into view. The button inside
 * stays as the keyboard fallback. Rebuilt when the row count changes: an
 * observer only fires on *changes*, so a sentinel still visible after a short
 * page would otherwise never ask for the next one.
 */
function useLoadMoreOnVisible(enabled: boolean, rowCount: number, loadMore: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, rowCount]);

  return ref;
}
