import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { HistoryListApi } from "../hooks/useHistoryList";
import { groupByDay } from "../lib/days";
import { ConfirmButton } from "./ConfirmButton";

/**
 * Day-grouped, infinitely scrolling list. Knows nothing about what a row is —
 * the panel passes `renderRow` for pages or media.
 */
export function HistoryList<T extends { id: number; startedAtMs: number }>({
  list,
  renderRow,
  empty,
}: {
  list: HistoryListApi<T>;
  renderRow: (item: T) => ReactNode;
  empty: ReactNode;
}) {
  const groups = useMemo(() => groupByDay(list.items, Date.now()), [list.items]);
  const sentinel = useLoadMoreOnVisible(list.hasMore, list.items.length, list.loadMore);

  if (list.loading && list.items.length === 0) {
    return <p className="pilpod-history-status">Loading…</p>;
  }
  if (list.items.length === 0) {
    return list.error ? <p className="pilpod-history-status pilpod-history-status--error">{list.error}</p> : <>{empty}</>;
  }

  return (
    <div className="pilpod-history-list">
      {groups.map((group) => (
        <section key={group.key} className="pilpod-history-day" aria-label={group.label}>
          <header className="pilpod-history-day__head">
            <h3 className="pilpod-history-day__label">{group.label}</h3>
            <ConfirmButton
              className="pilpod-history-textbtn"
              confirmLabel="Remove all?"
              title={`Remove everything from ${group.label}`}
              onConfirm={() => void list.clearRange(group.startMs, group.endMs)}
            >
              Remove day
            </ConfirmButton>
          </header>
          <ul className="pilpod-history-rows">{group.items.map(renderRow)}</ul>
        </section>
      ))}
      {list.error ? <p className="pilpod-history-status pilpod-history-status--error">{list.error}</p> : null}
      {list.hasMore ? (
        <div ref={sentinel} className="pilpod-history-more">
          <button
            type="button"
            className="pilpod-history-textbtn"
            disabled={list.loadingMore}
            onClick={list.loadMore}
          >
            {list.loadingMore ? "Loading…" : "Show older"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Call `loadMore` whenever the returned element scrolls into view. The button
 * inside the sentinel stays as the keyboard / no-observer fallback.
 *
 * The observer is rebuilt when the row count changes: an observer only fires
 * on *changes* in visibility, so a sentinel still on screen after a short page
 * would otherwise never ask for the next one.
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
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, rowCount]);

  return ref;
}
