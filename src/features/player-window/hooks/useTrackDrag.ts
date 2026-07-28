import { useCallback, useEffect, useRef, useState } from "react";

/** Pixels the pointer must travel before a press becomes a drag (not a click). */
const THRESHOLD = 4;
/** Distance from a scroll edge at which the list starts scrolling itself. */
const EDGE = 28;
const EDGE_STEP = 8;

export type DragState = {
  id: string;
  /** Index the row started at. */
  from: number;
  /** Index it would land on if dropped now. */
  to: number;
  /** How far the dragged row has moved, in pixels. */
  dy: number;
  /** The dragged row's height — how far every displaced row shifts. */
  height: number;
};

type Pending = {
  id: string;
  index: number;
  pointerId: number;
  startY: number;
  startScroll: number;
  el: HTMLElement;
};

/**
 * Reordering by pointer rather than HTML5 drag-and-drop.
 *
 * The native API cannot animate anything — the browser drags a ghost image and
 * the list can only jump on drop — and it is unreliable inside an embedded
 * webview. Driving it from pointer events instead means the row follows the
 * pointer exactly, its neighbours slide out of the way as it passes them, and
 * the list scrolls itself when the drag reaches an edge.
 *
 * Nothing is committed until release, and a press that never crosses
 * `THRESHOLD` stays a click, so tapping a row still plays it.
 */
export function useTrackDrag({
  count,
  scrollRef,
  onCommit,
}: {
  count: number;
  scrollRef: React.RefObject<HTMLElement | null>;
  onCommit: (from: number, to: number) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const pending = useRef<Pending | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastY = useRef(0);
  const suppressClick = useRef(false);
  const autoScroll = useRef<number | null>(null);

  dragRef.current = drag;

  const stopAutoScroll = useCallback(() => {
    if (autoScroll.current != null) {
      window.clearInterval(autoScroll.current);
      autoScroll.current = null;
    }
  }, []);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  const recompute = useCallback(
    (clientY: number) => {
      const p = pending.current;
      const d = dragRef.current;
      if (!p || !d) return;
      const scrolled = (scrollRef.current?.scrollTop ?? 0) - p.startScroll;
      const dy = clientY - p.startY + scrolled;
      const moved = d.height > 0 ? Math.round(dy / d.height) : 0;
      const to = Math.min(count - 1, Math.max(0, p.index + moved));
      const next = { ...d, dy, to };
      dragRef.current = next;
      setDrag(next);
    },
    [count, scrollRef],
  );

  /** Scroll the list while the pointer sits near one of its edges. */
  const updateAutoScroll = useCallback(
    (clientY: number) => {
      const box = scrollRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const dir =
        clientY < rect.top + EDGE ? -1 : clientY > rect.bottom - EDGE ? 1 : 0;
      if (dir === 0) {
        stopAutoScroll();
        return;
      }
      if (autoScroll.current != null) return;
      autoScroll.current = window.setInterval(() => {
        box.scrollTop += dir * EDGE_STEP;
        recompute(lastY.current);
      }, 16);
    },
    [recompute, scrollRef, stopAutoScroll],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, index: number, id: string) => {
      if (e.button !== 0) return;
      // The row menu is not a drag handle.
      if ((e.target as HTMLElement).closest(".pilpod-pw-menu")) return;
      pending.current = {
        id,
        index,
        pointerId: e.pointerId,
        startY: e.clientY,
        startScroll: scrollRef.current?.scrollTop ?? 0,
        el: e.currentTarget,
      };
      lastY.current = e.clientY;
    },
    [scrollRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const p = pending.current;
      if (!p || p.pointerId !== e.pointerId) return;
      lastY.current = e.clientY;

      if (!dragRef.current) {
        if (Math.abs(e.clientY - p.startY) < THRESHOLD) return;
        // Promote the press to a drag.
        try {
          p.el.setPointerCapture(p.pointerId);
        } catch {
          /* capture is best effort */
        }
        const height = p.el.getBoundingClientRect().height || 1;
        const next: DragState = { id: p.id, from: p.index, to: p.index, dy: 0, height };
        dragRef.current = next;
        setDrag(next);
        suppressClick.current = true;
      }

      e.preventDefault();
      recompute(e.clientY);
      updateAutoScroll(e.clientY);
    },
    [recompute, updateAutoScroll],
  );

  const finish = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const p = pending.current;
      const d = dragRef.current;
      pending.current = null;
      stopAutoScroll();
      if (!d) return;
      if (p) {
        try {
          p.el.releasePointerCapture(p.pointerId);
        } catch {
          /* already released */
        }
      }
      dragRef.current = null;
      setDrag(null);
      if (d.to !== d.from) onCommit(d.from, d.to);
      // The click that follows this release belongs to the drag, not the row.
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      e.preventDefault();
    },
    [onCommit, stopAutoScroll],
  );

  /** Where a row should be painted right now, given the drag in progress. */
  const rowStyle = useCallback(
    (index: number): React.CSSProperties | undefined => {
      if (!drag) return undefined;
      if (index === drag.from) {
        return {
          transform: `translateY(${drag.dy}px)`,
          transition: "none",
          zIndex: 5,
          position: "relative",
        };
      }
      const shift =
        drag.to > drag.from
          ? index > drag.from && index <= drag.to
            ? -drag.height
            : 0
          : index >= drag.to && index < drag.from
            ? drag.height
            : 0;
      return shift ? { transform: `translateY(${shift}px)` } : undefined;
    },
    [drag],
  );

  return {
    drag,
    rowStyle,
    /** True while the click that ends a drag is still pending. */
    shouldSuppressClick: () => suppressClick.current,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}
