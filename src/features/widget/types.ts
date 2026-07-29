/**
 * The widget contract, mirroring `src-tauri/src/widget/model.rs` exactly.
 *
 * Rust is the single writer for all of this: the dashboard menu edits it
 * through commands, the widget window reads it, and both re-render from the
 * same `widget://state` broadcast. Keeping the shapes identical on both sides
 * means a placement change is one round-trip and zero reconciliation.
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
 * Where the widget lives. A discriminated union so `switch (placement.mode)`
 * stays exhaustive when a third mode is added (edge-docked, follow-cursor…).
 */
export type WidgetPlacement =
  | { mode: "free"; x: number; y: number }
  | { mode: "corner"; corner: WidgetCorner };

export type WidgetState = {
  enabled: boolean;
  placement: WidgetPlacement;
  /** Live only — the widget is showing its media panel rather than the chip. */
  expanded: boolean;
};

export const DEFAULT_WIDGET_STATE: WidgetState = {
  enabled: false,
  placement: { mode: "corner", corner: "bottomRight" },
  expanded: false,
};

/** Human labels for the corner buttons, in reading order. */
export const WIDGET_CORNER_LABELS: Record<WidgetCorner, string> = {
  topLeft: "Top left",
  topRight: "Top right",
  bottomLeft: "Bottom left",
  bottomRight: "Bottom right",
};

/**
 * Degrees to rotate the logo for each corner.
 *
 * Bottom corners read upright; top corners are flipped, so the logo always
 * points *away* from the screen edge it is tucked against. Only two states,
 * not four — quarter turns would leave the logo lying on its side in the
 * left/right pairs, which reads as broken rather than deliberate.
 */
export const WIDGET_CORNER_ROTATION: Record<WidgetCorner, number> = {
  bottomLeft: 0,
  bottomRight: 0,
  topLeft: 180,
  topRight: 180,
};

/**
 * Pixel sizes mirrored from `model.rs`; used for CSS sizing only.
 *
 * The chip window is exactly the logo: no plate behind it, so no padding
 * between the artwork and the screen corner.
 */
export const WIDGET_CHIP_PX = 34;
export const WIDGET_PANEL_W = 360;
export const WIDGET_PANEL_H = 450;

/** Pointer travel (px) that turns a press into a drag rather than a click. */
export const WIDGET_DRAG_THRESHOLD_PX = 6;
