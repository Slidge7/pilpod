import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Open/close + viewport placement for a menu anchored to a trigger button.
 *
 * Tab rows live inside scrollable, virtualisable panels, so the menu is
 * rendered in a portal with `position: fixed` rather than inside the row —
 * otherwise it would be clipped by the panel's `overflow` and would push the
 * row's layout around. That means placement has to be recomputed whenever the
 * anchor moves, which is what the scroll/resize listeners below do.
 *
 * Listeners are attached only while the menu is open, so a page of closed
 * menus costs nothing.
 */

export interface AnchoredMenuPosition {
  top: number;
  left: number;
}

/** Gap between the trigger and the menu, and the min margin from the viewport. */
const GAP_PX = 6;
const EDGE_PX = 8;

export function useAnchoredMenu({ width, height }: { width: number; height: number }) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<AnchoredMenuPosition>({ top: 0, left: 0 });

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer the real rendered height once it exists: `height` is the worst
    // case, and reserving it for a short menu would push it away from its
    // anchor for no reason.
    const h = menuRef.current?.offsetHeight || height;

    // Right-align to the trigger, clamped to the viewport.
    const left = Math.min(
      Math.max(EDGE_PX, r.right - width),
      Math.max(EDGE_PX, vw - width - EDGE_PX),
    );
    // Below by default; flip above when the bottom half is too tight.
    const below = r.bottom + GAP_PX;
    const top =
      below + h > vh - EDGE_PX && r.top - GAP_PX - h > EDGE_PX
        ? r.top - GAP_PX - h
        : Math.min(below, Math.max(EDGE_PX, vh - h - EDGE_PX));

    setPos((prev) => (prev.top === top && prev.left === left ? prev : { top, left }));
  }, [width, height]);

  // Place before paint so the menu never flashes at the wrong spot.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => place();
    // Capture phase: catches scrolling of any ancestor panel, not just window.
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        anchorRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, place]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  return { anchorRef, menuRef, open, setOpen, toggle, close, pos };
}
