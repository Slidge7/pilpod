/**
 * The widget contract, mirroring `src-tauri/src/widget/model.rs` exactly.
 *
 * Rust is the single writer for all of this: the dashboard menu edits it
 * through commands, the widget window reads it, and both re-render from the
 * same `widget://state` broadcast. Keeping the shapes identical on both sides
 * means a placement change is one round-trip and zero reconciliation.
 *
 * Nothing here imports React — the collapsed widget is plain DOM and must be
 * able to use these types and constants without pulling in a UI runtime.
 */

/** Broadcast by Rust after every state change. Payload: {@link WidgetState}. */
export const WIDGET_STATE_EVENT = "widget://state";

export const WIDGET_CORNERS = [
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
] as const;

export type WidgetCorner = (typeof WIDGET_CORNERS)[number];

/**
 * Accent options for the chip, in menu order.
 *
 * `hologram` is the odd one out: not a colour but an animated multi-hue
 * treatment. It sits last so the four solid choices read as a palette and it
 * reads as the alternative to them.
 */
export const WIDGET_ACCENTS = [
  "blue",
  "green",
  "yellow",
  "red",
  "hologram",
] as const;

export type WidgetAccent = (typeof WIDGET_ACCENTS)[number];

export const WIDGET_ACCENT_LABELS: Record<WidgetAccent, string> = {
  blue: "Blue",
  green: "Green",
  yellow: "Yellow",
  red: "Red",
  hologram: "Hologram — colours drift and blend",
};

/**
 * Where the widget lives. A discriminated union so `switch (placement.mode)`
 * stays exhaustive when a third mode is added (edge-docked, follow-cursor…).
 */
export type WidgetPlacement =
  | { mode: "free"; x: number; y: number }
  | { mode: "corner"; corner: WidgetCorner };

export type WidgetState = {
  enabled: boolean;
  placement: WidgetPlacement;
  accent: WidgetAccent;
  /** Triangle edge length in logical pixels. */
  size: number;
  /** Live only — the widget is showing its media panel rather than the chip. */
  expanded: boolean;
  /** Live only — the panel is also showing the full browser list. */
  browsersOpen: boolean;
};

/** Size bounds, mirrored from `model.rs`. */
export const WIDGET_SIZE_MIN = 16;
export const WIDGET_SIZE_MAX = 96;
export const WIDGET_SIZE_DEFAULT = 40;

export const DEFAULT_WIDGET_STATE: WidgetState = {
  enabled: false,
  placement: { mode: "corner", corner: "bottomRight" },
  accent: "blue",
  size: WIDGET_SIZE_DEFAULT,
  expanded: false,
  browsersOpen: false,
};

/** Human labels for the corner buttons, in reading order. */
export const WIDGET_CORNER_LABELS: Record<WidgetCorner, string> = {
  topLeft: "Top left",
  topRight: "Top right",
  bottomLeft: "Bottom left",
  bottomRight: "Bottom right",
};

/**
 * The two forms the collapsed widget takes.
 *
 * A corner-pinned widget is a triangle that fills the screen corner. A free
 * one has no edge to hug, so a triangle would read as a shard floating in
 * space — it becomes a sphere with the PilPod mark inside instead.
 */
export type WidgetShape = "corner" | "bubble";

export function widgetShape(placement: WidgetPlacement): WidgetShape {
  return placement.mode === "corner" ? "corner" : "bubble";
}

/**
 * Which corner of its own box the triangle's right angle sits in.
 *
 * The triangle fills the corner of the *screen*, so its right angle has to
 * land on the same corner the window is pinned to; the hypotenuse then always
 * faces inward. The bubble has no right angle, but still inherits a corner so
 * its specular highlight has a consistent light direction.
 */
export function triangleCorner(placement: WidgetPlacement): WidgetCorner {
  return placement.mode === "corner" ? placement.corner : "bottomRight";
}

/**
 * Identity of *where* the widget is, ignoring how it looks.
 *
 * The reveal animation fires when this changes and not otherwise — recolouring
 * or resizing the widget should not make it bounce, and neither should the
 * per-frame position updates that arrive while the user drags it (mode stays
 * `free` throughout).
 */
export function placementKey(placement: WidgetPlacement): string {
  return placement.mode === "corner" ? `corner:${placement.corner}` : "free";
}

/** Pointer travel (px) that turns a press into a drag rather than a click. */
export const WIDGET_DRAG_THRESHOLD_PX = 6;
