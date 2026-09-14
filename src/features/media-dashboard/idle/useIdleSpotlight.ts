import { useEffect, type RefObject } from "react";
import {
  DASHBOARD_IDLE_EDGE_SELECTOR,
  DASHBOARD_IDLE_MAX_EDGES,
  DASHBOARD_IDLE_REGION_SELECTOR,
  DASHBOARD_IDLE_REMEASURE_MS,
  DASHBOARD_IDLE_SPOTLIGHT_RADIUS,
} from "./config";

export type UseIdleSpotlightOptions = {
  /** Usually `isUserIdle`. Everything is torn down when this goes false. */
  active: boolean;
  /** Positioned ancestor the overlay is appended to (the inner shell). */
  hostRef: RefObject<HTMLElement | null>;
  /** Scrolling viewport the overlay is clipped to (the dashboard main). */
  viewportRef: RefObject<HTMLElement | null>;
  radius?: number;
  regionSelector?: string;
  edgeSelector?: string;
  maxEdges?: number;
};

type EdgeMeasurement = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: string;
};

/**
 * A torch that follows the cursor across the faded dashboard, lighting only the
 * outlines of whatever sits under it.
 *
 * Why it is built this way: the obvious implementation — a radial mask over the
 * content, repositioned on every mouse move — re-rasterises a viewport-sized
 * layer 60 times a second. Instead the mask here is *static*: a small lens
 * element (2r x 2r) carrying a fixed radial gradient, moved with a transform.
 * Inside it a counter-translated "world" holds one outline ring per surface, so
 * the rings appear pinned to the page while the lens slides over them. A frame
 * costs two transform writes on already-composited layers — no layout, no
 * style recalc on the content, and a repaint area of at most the lens box.
 *
 * Ring geometry is measured only when the layout can actually have changed
 * (activation, scroll, resize, and a slow tick while lit), never during a move.
 *
 * The overlay is created imperatively rather than rendered by React on purpose:
 * the cursor position must never become component state, or every mouse move
 * would re-render the dashboard.
 */
export function useIdleSpotlight({
  active,
  hostRef,
  viewportRef,
  radius = DASHBOARD_IDLE_SPOTLIGHT_RADIUS,
  regionSelector = DASHBOARD_IDLE_REGION_SELECTOR,
  edgeSelector = DASHBOARD_IDLE_EDGE_SELECTOR,
  maxEdges = DASHBOARD_IDLE_MAX_EDGES,
}: UseIdleSpotlightOptions): void {
  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;

    const host = hostRef.current;
    const viewport = viewportRef.current;
    if (!host || !viewport) return;

    // A torch that tracks the pointer is motion. Respect the opt-out.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const overlay = document.createElement("div");
    overlay.className = "pilpod-idle-spotlight";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.setProperty("--pilpod-idle-spot-r", `${radius}px`);

    const lens = document.createElement("div");
    lens.className = "pilpod-idle-spotlight__lens";

    const world = document.createElement("div");
    world.className = "pilpod-idle-spotlight__world";

    lens.appendChild(world);
    overlay.appendChild(lens);
    host.appendChild(overlay);

    const rings: HTMLDivElement[] = [];

    // Overlay origin in client coords; everything below is overlay-relative.
    let originX = 0;
    let originY = 0;
    let overlayWidth = 0;
    let overlayHeight = 0;
    let regionLeft = 0;
    let regionTop = 0;
    let regionRight = -1;
    let regionBottom = -1;

    let pointerX = 0;
    let pointerY = 0;
    let hasPointer = false;
    let isLit = false;

    let moveFrame = 0;
    let measureFrame = 0;
    let remeasureTimer: ReturnType<typeof setInterval> | null = null;

    const setLit = (next: boolean) => {
      if (isLit === next) return;
      isLit = next;
      overlay.classList.toggle("is-lit", next);
    };

    const measure = () => {
      measureFrame = 0;

      // ---- read pass (no writes in between, so layout is flushed once) ----
      const hostRect = host.getBoundingClientRect();
      const viewRect = viewport.getBoundingClientRect();
      const regionEl = viewport.querySelector(regionSelector);
      const regionRect = regionEl ? regionEl.getBoundingClientRect() : null;

      const measurements: EdgeMeasurement[] = [];
      if (regionEl) {
        const nodes = regionEl.querySelectorAll<HTMLElement>(edgeSelector);
        const pad = radius;
        for (let i = 0; i < nodes.length && measurements.length < maxEdges; i++) {
          const node = nodes[i];
          const rect = node.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) continue;
          // Offscreen surfaces can never fall inside the lens — skip the node.
          if (rect.bottom < viewRect.top - pad) continue;
          if (rect.top > viewRect.bottom + pad) continue;
          measurements.push({
            x: rect.left - viewRect.left,
            y: rect.top - viewRect.top,
            width: rect.width,
            height: rect.height,
            radius: window.getComputedStyle(node).borderRadius,
          });
        }
      }

      // ---- write pass ----
      originX = viewRect.left;
      originY = viewRect.top;
      overlayWidth = viewRect.width;
      overlayHeight = viewRect.height;

      overlay.style.width = `${viewRect.width}px`;
      overlay.style.height = `${viewRect.height}px`;
      overlay.style.transform = `translate3d(${viewRect.left - hostRect.left}px, ${
        viewRect.top - hostRect.top
      }px, 0)`;

      if (regionRect) {
        regionLeft = regionRect.left - originX;
        regionTop = regionRect.top - originY;
        regionRight = regionRect.right - originX;
        regionBottom = regionRect.bottom - originY;
      } else {
        regionRight = -1;
        regionBottom = -1;
      }

      for (let i = 0; i < measurements.length; i++) {
        const m = measurements[i];
        let ring = rings[i];
        if (!ring) {
          ring = document.createElement("div");
          ring.className = "pilpod-idle-spotlight__edge";
          world.appendChild(ring);
          rings.push(ring);
        }
        ring.style.width = `${m.width}px`;
        ring.style.height = `${m.height}px`;
        ring.style.borderRadius = m.radius;
        ring.style.transform = `translate3d(${m.x}px, ${m.y}px, 0)`;
        ring.style.display = "";
      }
      for (let i = measurements.length; i < rings.length; i++) {
        rings[i].style.display = "none";
      }
    };

    const scheduleMeasure = () => {
      if (measureFrame !== 0) return;
      measureFrame = window.requestAnimationFrame(measure);
    };

    const drawFrame = () => {
      moveFrame = 0;
      if (!hasPointer) return;

      const x = pointerX - originX;
      const y = pointerY - originY;

      const inside =
        regionRight > regionLeft &&
        x >= regionLeft - 8 &&
        x <= regionRight + 8 &&
        y >= regionTop - 8 &&
        y <= regionBottom + 8 &&
        x >= 0 &&
        x <= overlayWidth &&
        y >= 0 &&
        y <= overlayHeight;

      setLit(inside);
      if (!inside) return;

      // Two composited transforms: the lens moves to the cursor, the world
      // moves the opposite way so the rings stay put on the page.
      lens.style.transform = `translate3d(${x - radius}px, ${y - radius}px, 0)`;
      world.style.transform = `translate3d(${radius - x}px, ${radius - y}px, 0)`;
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      hasPointer = true;
      if (moveFrame === 0) moveFrame = window.requestAnimationFrame(drawFrame);
    };

    const onPointerOut = () => {
      hasPointer = false;
      setLit(false);
    };

    const listenerOpts = { passive: true } as const;
    viewport.addEventListener("pointermove", onPointerMove, listenerOpts);
    viewport.addEventListener("pointerleave", onPointerOut, listenerOpts);
    viewport.addEventListener("pointercancel", onPointerOut, listenerOpts);
    viewport.addEventListener("scroll", scheduleMeasure, listenerOpts);
    window.addEventListener("resize", scheduleMeasure, listenerOpts);
    window.addEventListener("blur", onPointerOut, listenerOpts);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleMeasure)
        : null;
    resizeObserver?.observe(viewport);

    // Cards appear, collapse and animate while nobody is clicking. A slow tick
    // keeps the rings honest without observing every mutation; it only runs
    // while the torch is actually on screen.
    remeasureTimer = setInterval(() => {
      if (isLit) scheduleMeasure();
    }, DASHBOARD_IDLE_REMEASURE_MS);

    measure();

    return () => {
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerleave", onPointerOut);
      viewport.removeEventListener("pointercancel", onPointerOut);
      viewport.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("blur", onPointerOut);
      resizeObserver?.disconnect();
      if (remeasureTimer != null) clearInterval(remeasureTimer);
      if (moveFrame !== 0) window.cancelAnimationFrame(moveFrame);
      if (measureFrame !== 0) window.cancelAnimationFrame(measureFrame);
      overlay.remove();
    };
  }, [
    active,
    hostRef,
    viewportRef,
    radius,
    regionSelector,
    edgeSelector,
    maxEdges,
  ]);
}
