export {
  DASHBOARD_IDLE_ACTIVITY_EVENTS,
  DASHBOARD_IDLE_BROWSER_OPACITY,
  DASHBOARD_IDLE_SHELL_CLASS,
  DASHBOARD_IDLE_TIMEOUT_MS,
  DASHBOARD_IDLE_WAKE_EVENTS,
  IDLE_INTERVALS,
} from "./config";
export type { DashboardIdleActivityEvent, DashboardIdleWakeEvent, IdleIntervalId } from "./config";
export { useDashboardIdleMode } from "./useDashboardIdleMode";
export type { UseDashboardIdleModeOptions } from "./useDashboardIdleMode";
export { useIdleConfig } from "./useIdleConfig";
export type { IdleController } from "./useIdleConfig";

