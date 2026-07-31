import { getCurrentWindow } from "@tauri-apps/api/window";
import { widgetApi } from "../ipc";
import {
  WIDGET_DRAG_THRESHOLD_PX,
  placementKey,
  triangleCorner,
  widgetShape,
  type WidgetState,
} from "../types";

/**
 * The collapsed widget, as plain DOM.
 *
 * ## Why there is no React here
 *
 * The widget window is on screen for as long as the user leaves it on, and it
 * is idle for almost all of that time. A React runtime resident in that window
 * buys nothing: the collapsed state is one element, a few attributes and a
 * click handler. Keeping it vanilla means the widget entry chunk is a few
 * kilobytes and the React graph is never parsed, never instantiated and never
 * holds a fiber tree — it loads on the first expand and is torn down again on
 * collapse (see `panel/mountPanel.ts`).
 *
 * ## Rendering
 *
 * Both forms — the corner triangle and the free-floating bubble — are built
 * from the same element tree; CSS picks between them off `data-shape`. Applying
 * new state therefore writes attributes only. No innerHTML, no reflow, no
 * re-render pass.
 *
 * The one thing JavaScript does drive is the reveal animation, because it has
 * to be *retriggered* on demand rather than played once on load. That runs
 * through the Web Animations API: keyframes handed straight to the compositor,
 * and each new call implicitly cancels the animation it replaces.
 */

type ChipHandle = {
  /** Apply a new state to the existing DOM. */
  update: (state: WidgetState) => void;
  destroy: () => void;
};

/** Springy overshoot — lands, tips past, settles. */
const REVEAL_MS = 620;
const PING_MS = 720;

const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function mountChip(host: HTMLElement): ChipHandle {
  host.className = "pilpod-chip";
  host.setAttribute("role", "button");
  host.setAttribute("tabindex", "0");

  // Radiating pulse that marks the landing spot. Sits behind the body.
  const ping = document.createElement("span");
  ping.className = "pilpod-chip__ping";
  ping.setAttribute("aria-hidden", "true");

  // The clipped/rounded surface. Everything visual lives inside it so the
  // clip-path (triangle) or border-radius (bubble) applies once.
  const body = document.createElement("span");
  body.className = "pilpod-chip__body";
  body.setAttribute("aria-hidden", "true");

  // Solid accents paint here; hologram hides it.
  const tint = document.createElement("span");
  tint.className = "pilpod-chip__tint";

  // Hologram: three oversized gradient plates drifting at different rates.
  // Separate elements rather than one animated gradient because rotating a
  // layer is a compositor transform, whereas animating gradient stops repaints
  // every frame — forever, on an always-on-top window.
  const holo = document.createElement("span");
  holo.className = "pilpod-chip__holo";
  for (let i = 0; i < 3; i += 1) {
    const plate = document.createElement("i");
    plate.className = "pilpod-chip__holo-plate";
    plate.dataset.plate = String(i);
    holo.append(plate);
  }

  const sheen = document.createElement("span");
  sheen.className = "pilpod-chip__sheen";

  body.append(tint, holo, sheen);

  // Bubble form only; CSS hides it for the triangle.
  const icon = document.createElement("img");
  icon.className = "pilpod-chip__icon";
  icon.src = "/pilpod-icon.png";
  icon.alt = "";
  icon.draggable = false;

  host.append(ping, body, icon);

  // Press bookkeeping. A press only becomes a window drag once the pointer
  // clears the threshold, so a slightly shaky click still opens the panel
  // instead of nudging the widget.
  let press: { id: number; x: number; y: number; dragged: boolean } | null = null;
  let draggable = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false };
    host.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id || press.dragged) return;
    // Pinned to a corner: the menu owns placement, so swallow the gesture
    // rather than letting the widget drift off its anchor.
    if (!draggable) return;

    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (dx * dx + dy * dy < WIDGET_DRAG_THRESHOLD_PX ** 2) return;

    press.dragged = true;
    // Hand the gesture to the OS. Rust records the landing position from the
    // window's `Moved` event, so there is no per-frame IPC during the drag.
    void getCurrentWindow().startDragging();
    try {
      host.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already gone */
    }
    press = null;
  };

  const endPress = (e: PointerEvent, cancelled: boolean) => {
    if (!press || e.pointerId !== press.id) return;
    try {
      host.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already gone */
    }
    const dragged = press.dragged;
    press = null;
    if (!cancelled && !dragged && e.button === 0) void widgetApi.setExpanded(true);
  };

  const onPointerUp = (e: PointerEvent) => endPress(e, false);
  const onPointerCancel = (e: PointerEvent) => endPress(e, true);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    void widgetApi.setExpanded(true);
  };

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerCancel);
  host.addEventListener("keydown", onKeyDown);

  /**
   * Announce a landing.
   *
   * The window has already been moved by Rust before this state arrives, so
   * the widget is sitting silently in a new place the user's eye has no reason
   * to be looking at. The overshoot draws it there and the pulse says "here",
   * which is the whole job.
   *
   * `transform-origin` comes from CSS per corner, so the triangle grows out of
   * the screen corner rather than inflating from its own middle.
   */
  const playReveal = () => {
    if (reducedMotion()) return;

    host.animate(
      [
        { transform: "scale(0.42)", opacity: 0, offset: 0 },
        { transform: "scale(1.14)", opacity: 1, offset: 0.42 },
        { transform: "scale(0.955)", offset: 0.68 },
        { transform: "scale(1.02)", offset: 0.85 },
        { transform: "scale(1)", offset: 1 },
      ],
      { duration: REVEAL_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "none" },
    );

    ping.animate(
      [
        { transform: "scale(0.5)", opacity: 0.7, offset: 0 },
        { transform: "scale(2.4)", opacity: 0, offset: 1 },
      ],
      { duration: PING_MS, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "none" },
    );
  };

  let lastPlacementKey: string | null = null;

  const update = (state: WidgetState) => {
    draggable = state.placement.mode === "free";

    const shape = widgetShape(state.placement);
    host.dataset.shape = shape;
    host.dataset.corner = triangleCorner(state.placement);
    host.dataset.accent = state.accent;
    host.dataset.placement = state.placement.mode;

    const hint = draggable
      ? "Open PilPod media — drag to move"
      : "Open PilPod media — placement is pinned (change it in the PilPod menu)";
    host.setAttribute("aria-label", hint);
    host.title = hint;

    // Fires on first appearance and on every move to a new spot, but not when
    // only the colour or size changed, and not while dragging.
    const key = placementKey(state.placement);
    if (key !== lastPlacementKey) {
      lastPlacementKey = key;
      playReveal();
    }
  };

  const destroy = () => {
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    host.removeEventListener("pointercancel", onPointerCancel);
    host.removeEventListener("keydown", onKeyDown);
    host.replaceChildren();
  };

  return { update, destroy };
}
