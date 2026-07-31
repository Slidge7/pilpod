/**
 * Public surface of the widget feature — what the *dashboard* needs.
 *
 * Note what is missing: the chip and the panel are not exported. They belong
 * to the widget window and are reached through `widget-main.ts` (plain DOM)
 * and a dynamic import (React). Exporting them here would let the dashboard
 * bundle pull them in by accident and quietly undo the split.
 */
export { useWidgetState, widgetApi, type WidgetController } from "./api";
export {
  WIDGET_ACCENTS,
  WIDGET_ACCENT_LABELS,
  WIDGET_CORNERS,
  WIDGET_CORNER_LABELS,
  WIDGET_SIZE_DEFAULT,
  WIDGET_SIZE_MAX,
  WIDGET_SIZE_MIN,
  WIDGET_STATE_EVENT,
  type WidgetAccent,
  type WidgetCorner,
  type WidgetPlacement,
  type WidgetState,
} from "./types";
