import { useCallback, useEffect, useRef, useState } from "react";
import {
  DASHBOARD_IDLE_WAKE_EVENTS,
  DASHBOARD_IDLE_TIMEOUT_MS,
} from "./config";

export type UseDashboardIdleModeOptions = {
  /** When false, idle mode never activates and listeners are not attached. */
  enabled?: boolean;
  /** Inactivity threshold before idle mode activates. */
  idleMs?: number;
  /** Optional root to listen on; defaults to `window`. */
  target?: Window | HTMLElement | null;
};

/**
 * Tracks intentional dashboard interaction. After `idleMs` without a click, tap,
 * or key press, returns `true` until the user interacts again.
 */
export function useDashboardIdleMode(
  options: UseDashboardIdleModeOptions = {},
): boolean {
  const {
    enabled = true,
    idleMs = DASHBOARD_IDLE_TIMEOUT_MS,
    target = typeof window !== "undefined" ? window : null,
  } = options;

  const [isIdle, setIsIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearIdleTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const markActive = useCallback(() => {
    setIsIdle(false);
    clearIdleTimer();
    timerRef.current = setTimeout(() => setIsIdle(true), idleMs);
  }, [clearIdleTimer, idleMs]);

  useEffect(() => {
    if (!enabled || target == null) {
      clearIdleTimer();
      setIsIdle(false);
      return;
    }

    markActive();

    for (const event of DASHBOARD_IDLE_WAKE_EVENTS) {
      target.addEventListener(event, markActive, { passive: true });
    }

    return () => {
      for (const event of DASHBOARD_IDLE_WAKE_EVENTS) {
        target.removeEventListener(event, markActive);
      }
      clearIdleTimer();
    };
  }, [enabled, target, markActive, clearIdleTimer]);

  return enabled ? isIdle : false;
}
