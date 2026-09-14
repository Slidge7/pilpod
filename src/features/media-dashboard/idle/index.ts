export {
  DASHBOARD_IDLE_ACTIVITY_EVENTS,
  DASHBOARD_IDLE_BROWSER_OPACITY,
  DASHBOARD_IDLE_EDGE_SELECTOR,
  DASHBOARD_IDLE_MAX_EDGES,
  DASHBOARD_IDLE_REGION_SELECTOR,
  DASHBOARD_IDLE_REMEASURE_MS,
  DASHBOARD_IDLE_SHELL_CLASS,
  DASHBOARD_IDLE_SPOTLIGHT_RADIUS,
  DASHBOARD_IDLE_SWALLOWED_EVENTS,
  DASHBOARD_IDLE_TIMEOUT_MS,
  DASHBOARD_IDLE_WAKE_EVENTS,
  DASHBOARD_IDLE_WAKE_GUARD_MS,
  IDLE_INTERVALS,
} from "./config";
export type { DashboardIdleActivityEvent, DashboardIdleWakeEvent, IdleIntervalId } from "./config";
export { useDashboardIdleMode } from "./useDashboardIdleMode";
export type { IdleGuardRoot, UseDashboardIdleModeOptions } from "./useDashboardIdleMode";
export { useIdleSpotlight } from "./useIdleSpotlight";
export type { UseIdleSpotlightOptions } from "./useIdleSpotlight";
export { useIdleConfig } from "./useIdleConfig";
export type { IdleController } from "./useIdleConfig";
