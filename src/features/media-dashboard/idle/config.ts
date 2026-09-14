/** Ms without user activity before dashboard idle mode activates (default fallback). */
export const DASHBOARD_IDLE_TIMEOUT_MS = 60_000;

/** Opacity for browser profile cards while idle (0–1). */
export const DASHBOARD_IDLE_BROWSER_OPACITY = 0.1;

/** Applied to the dashboard inner shell when idle mode is active. */
export const DASHBOARD_IDLE_SHELL_CLASS = "pilpod-dashboard-shell__inner--user-idle";

/**
 * Intentional interactions that wake idle mode and restart the timer.
 * Hover / cursor enter alone does not count — user must click, tap, or press a key.
 */
export const DASHBOARD_IDLE_WAKE_EVENTS = [
  "pointerdown",
  "keydown",
  "touchstart",
] as const;

/** @deprecated Use DASHBOARD_IDLE_WAKE_EVENTS */
export const DASHBOARD_IDLE_ACTIVITY_EVENTS = DASHBOARD_IDLE_WAKE_EVENTS;

export type DashboardIdleWakeEvent = (typeof DASHBOARD_IDLE_WAKE_EVENTS)[number];
export type DashboardIdleActivityEvent = DashboardIdleWakeEvent;

/**
 * Pointer events swallowed after a wake click, so the interaction that brought
 * the faded content back never reaches a button. `pointerdown` is cancelled at
 * capture time, but `click` fires independently of it — it has to be caught on
 * the way out too, or the card underneath still gets activated.
 */
export const DASHBOARD_IDLE_SWALLOWED_EVENTS = [
  "mousedown",
  "mouseup",
  "pointerup",
  "click",
  "auxclick",
  "dblclick",
  "contextmenu",
] as const;

/**
 * How long the swallow stays armed after the wake press. Long enough to cover
 * a slow click or a press-drag-release, short enough that a genuine second
 * click is never eaten.
 */
export const DASHBOARD_IDLE_WAKE_GUARD_MS = 900;

/** Container whose dimmed content the wake guard and the spotlight apply to. */
export const DASHBOARD_IDLE_REGION_SELECTOR = ".pilpod-browser-panel__groups";

/** Radius (px) of the cursor spotlight that lights faded edges while idle. */
export const DASHBOARD_IDLE_SPOTLIGHT_RADIUS = 150;

/**
 * Elements whose outline glows inside the spotlight. Structural surfaces only —
 * tracing every button would multiply the ring count for no readability gain.
 */
export const DASHBOARD_IDLE_EDGE_SELECTOR = [
  ".pilpod-browser-profile",
  ".pilpod-browser-profile__head",
  ".pilpod-browser-profile__window",
  ".pilpod-browser-profile__other",
  ".pilpod-media-item",
  ".pilpod-control-card",
].join(",");

/** Upper bound on ring nodes, so a huge tab list can't grow the overlay forever. */
export const DASHBOARD_IDLE_MAX_EDGES = 90;

/** Re-measure cadence (ms) while the spotlight is lit, to track layout drift. */
export const DASHBOARD_IDLE_REMEASURE_MS = 800;

export const IDLE_ENABLED_STORAGE_KEY = "pilpod-idle-enabled";
export const IDLE_INTERVAL_STORAGE_KEY = "pilpod-idle-interval";

export const IDLE_INTERVALS = [
  { id: "20s", label: "20s", ms: 20_000 },
  { id: "1m", label: "1m", ms: 60_000 },
  { id: "2m", label: "2m", ms: 2 * 60_000 },
  { id: "5m", label: "5m", ms: 5 * 60_000 },
  { id: "15m", label: "15m", ms: 15 * 60_000 },
] as const;

export type IdleIntervalId = (typeof IDLE_INTERVALS)[number]["id"];
export const IDLE_DEFAULT_INTERVAL: IdleIntervalId = "1m";
