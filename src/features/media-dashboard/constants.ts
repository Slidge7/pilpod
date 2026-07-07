export const BROWSERS_UPDATE_EVENT = "browsers://update";
export const ALWAYS_ON_TOP_STORAGE_KEY = "pilpod-always-on-top";
export const WIDGET_ENABLED_STORAGE_KEY = "pilpod-widget-enabled";
/** Currently selected wallpaper name, or "" / missing when wallpaper is off. */
export const WALLPAPER_SELECTION_STORAGE_KEY = "pilpod-wallpaper-selection";
export const WALLPAPER_RANDOM_STORAGE_KEY = "pilpod-wallpaper-random";
export const WALLPAPER_AUTOSWITCH_STORAGE_KEY = "pilpod-wallpaper-autoswitch";
export const WALLPAPER_INTERVAL_STORAGE_KEY = "pilpod-wallpaper-interval";

/** User-selectable auto-switch intervals (id + label + milliseconds). */
export const WALLPAPER_INTERVALS = [
  { id: "5m", label: "5m", ms: 5 * 60_000 },
  { id: "30m", label: "30m", ms: 30 * 60_000 },
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "4h", label: "4h", ms: 4 * 60 * 60_000 },
  { id: "12h", label: "12h", ms: 12 * 60 * 60_000 },
  { id: "1d", label: "1d", ms: 24 * 60 * 60_000 },
] as const;

export type WallpaperIntervalId = (typeof WALLPAPER_INTERVALS)[number]["id"];
export const WALLPAPER_DEFAULT_INTERVAL: WallpaperIntervalId = "30m";
export const WIDGET_TRANSITION_MS = 230;
export const WIDGET_DRAG_THRESHOLD_PX = 6;
/** Logical inner size for the widget chip (matches Rust `WIDGET_LOGICAL`). */
export const WIDGET_CHIP_LOGICAL_PX = 50;
/** Logical inner size for the expanded “media list only” widget panel. */
export const WIDGET_EXPANDED_WIDTH_LOGICAL = 360;
export const WIDGET_EXPANDED_HEIGHT_LOGICAL = 450;
/** Ignore blur shortly after expand so focus churn does not instant-collapse. */
export const WIDGET_EXPAND_BLUR_GRACE_MS = 280;
