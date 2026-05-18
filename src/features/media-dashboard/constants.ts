export const BROWSERS_UPDATE_EVENT = "browsers://update";
export const ALWAYS_ON_TOP_STORAGE_KEY = "pilpod-always-on-top";
export const WIDGET_ENABLED_STORAGE_KEY = "pilpod-widget-enabled";
export const WIDGET_TRANSITION_MS = 230;
export const WIDGET_DRAG_THRESHOLD_PX = 6;
/** Logical inner size for the widget chip (matches Rust `WIDGET_LOGICAL`). */
export const WIDGET_CHIP_LOGICAL_PX = 50;
/** Logical inner size for the expanded “media list only” widget panel. */
export const WIDGET_EXPANDED_WIDTH_LOGICAL = 360;
export const WIDGET_EXPANDED_HEIGHT_LOGICAL = 450;
/** Ignore blur shortly after expand so focus churn does not instant-collapse. */
export const WIDGET_EXPAND_BLUR_GRACE_MS = 280;
