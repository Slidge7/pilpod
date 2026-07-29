import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  WIDGET_CORNER_ROTATION,
  WIDGET_DRAG_THRESHOLD_PX,
  type WidgetPlacement,
} from "../types";
import "./WidgetChip.css";

type Props = {
  placement: WidgetPlacement;
  onExpand: () => void;
};

/**
 * The collapsed widget: the PilPod logo, and nothing else.
 *
 * No plate, no background, no border — the window is sized to the artwork so
 * the logo sits directly in the screen corner rather than floating inside a
 * transparent margin. Orientation is derived from the placement: bottom
 * corners upright, top corners flipped, so the logo always points away from
 * the edge it is tucked against.
 *
 * There is deliberately no close button. At this size a hit target for it
 * would overlap the logo's own, and turning the widget off already has a home
 * in the menu, next to the placement controls that put it there.
 */
export function WidgetChip({ placement, onExpand }: Props) {
  const isCorner = placement.mode === "corner";
  const rotation = isCorner ? WIDGET_CORNER_ROTATION[placement.corner] : 0;

  // Press bookkeeping. A press only becomes a window drag once the pointer
  // clears the threshold, so a slightly shaky click still expands the panel
  // instead of nudging the widget.
  const press = useRef<{ id: number; x: number; y: number; dragged: boolean } | null>(
    null,
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const p = press.current;
      if (!p || e.pointerId !== p.id || p.dragged) return;
      // Pinned to a corner: the menu owns placement, so swallow the gesture
      // rather than letting the widget drift off its anchor.
      if (isCorner) return;

      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (dx * dx + dy * dy < WIDGET_DRAG_THRESHOLD_PX ** 2) return;

      p.dragged = true;
      // Hand the gesture to the OS. Rust records the landing position from the
      // window's `Moved` event, so there is no per-frame IPC during the drag.
      void getCurrentWindow().startDragging();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture already gone */
      }
      press.current = null;
    },
    [isCorner],
  );

  const endPress = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const p = press.current;
      if (!p || e.pointerId !== p.id) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture already gone */
      }
      press.current = null;
      if (!cancelled && !p.dragged && e.button === 0) onExpand();
    },
    [onExpand],
  );

  const hint = isCorner
    ? "Open media list — placement is pinned to a corner (change it in the PilPod menu)"
    : "Open media list — drag to move";

  return (
    <div
      className="pilpod-widget-chip-root"
      data-placement={placement.mode}
      data-corner={isCorner ? placement.corner : undefined}
      style={{ ["--pilpod-widget-rotation" as string]: `${rotation}deg` }}
      role="button"
      tabIndex={0}
      aria-label={hint}
      title={hint}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onExpand();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPress(e, false)}
      onPointerCancel={(e) => endPress(e, true)}
    >
      <img
        className="pilpod-widget-chip-root__glyph"
        src="/pilpod-icon.png"
        alt=""
        draggable={false}
      />
    </div>
  );
}
