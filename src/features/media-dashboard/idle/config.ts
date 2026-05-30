/** Ms without user activity before dashboard idle mode activates. */
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
