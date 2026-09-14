import { useCallback, useEffect, useRef, useState } from "react";
import {
  DASHBOARD_IDLE_SWALLOWED_EVENTS,
  DASHBOARD_IDLE_TIMEOUT_MS,
  DASHBOARD_IDLE_WAKE_EVENTS,
  DASHBOARD_IDLE_WAKE_GUARD_MS,
} from "./config";

/** Anything that can point at the dimmed region: node, ref, or getter. */
export type IdleGuardRoot =
  | Element
  | null
  | { current: Element | null }
  | (() => Element | null);

export type UseDashboardIdleModeOptions = {
  /** When false, idle mode never activates and listeners are not attached. */
  enabled?: boolean;
  /** Inactivity threshold before idle mode activates. */
  idleMs?: number;
  /** Optional root to listen on; defaults to `window`. */
  target?: Window | HTMLElement | null;
  /**
   * Swallow the press that wakes idle mode instead of letting it through.
   * The user clicked to see the screen again, not to press whatever happened
   * to be under the cursor — closing a tab or bookmarking something they
   * never aimed at is the worst possible answer to "show me the content".
   * Only presses inside `guardRoot` are swallowed: the header and the dock
   * stay visible while idle, so a click there was aimed.
   */
  guardWakeClick?: boolean;
  /** The dimmed region. Presses outside it pass through untouched. */
  guardRoot?: IdleGuardRoot;
};

function resolveGuardRoot(root: IdleGuardRoot): Element | null {
  if (root == null) return null;
  if (typeof root === "function") return root();
  if ("current" in root) return root.current;
  return root;
}

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
    guardWakeClick = true,
    guardRoot = null,
  } = options;

  const [isIdle, setIsIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Event handlers run outside React's render cycle and need the *current*
  // idle value, not the one captured when the listener was attached.
  const isIdleRef = useRef(false);
  const guardRootRef = useRef<IdleGuardRoot>(guardRoot);
  const guardEnabledRef = useRef(guardWakeClick);
  const swallowArmedRef = useRef(false);
  const swallowDeadlineRef = useRef(0);

  useEffect(() => {
    guardRootRef.current = guardRoot;
    guardEnabledRef.current = guardWakeClick;
  }, [guardRoot, guardWakeClick]);

  const clearIdleTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const setIdle = useCallback((next: boolean) => {
    isIdleRef.current = next;
    setIsIdle((prev) => (prev === next ? prev : next));
  }, []);

  const markActive = useCallback(() => {
    setIdle(false);
    clearIdleTimer();
    timerRef.current = setTimeout(() => setIdle(true), idleMs);
  }, [clearIdleTimer, idleMs, setIdle]);

  useEffect(() => {
    if (!enabled || target == null) {
      clearIdleTimer();
      setIdle(false);
      swallowArmedRef.current = false;
      return;
    }

    markActive();

    const now = () =>
      typeof performance !== "undefined" ? performance.now() : Date.now();

    const kill = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    /**
     * The wake press. Cancelled at capture time — before React, before any
     * handler on the card — so nothing downstream ever sees it.
     */
    const onWakePointer = (event: Event) => {
      const wasIdle = isIdleRef.current;
      markActive();
      if (!wasIdle || !guardEnabledRef.current) return;

      const root = resolveGuardRoot(guardRootRef.current);
      const node = event.target as Node | null;
      if (!root || !node || !root.contains(node)) return;

      kill(event);
      swallowArmedRef.current = true;
      swallowDeadlineRef.current = now() + DASHBOARD_IDLE_WAKE_GUARD_MS;
    };

    const onWakeOther = () => {
      markActive();
    };

    /**
     * Cancelling `pointerdown` suppresses the compatibility mouse events but
     * not `click`, which the browser still synthesises on release. Everything
     * that belongs to the same press is dropped until the click lands.
     */
    const onSwallow = (event: Event) => {
      if (!swallowArmedRef.current) return;
      if (now() > swallowDeadlineRef.current) {
        swallowArmedRef.current = false;
        return;
      }
      kill(event);
      if (
        event.type === "click" ||
        event.type === "auxclick" ||
        event.type === "contextmenu"
      ) {
        swallowArmedRef.current = false;
      }
    };

    // Capture phase, non-passive: both are required to cancel the press.
    const capture = { capture: true, passive: false } as const;
    const passiveCapture = { capture: true, passive: true } as const;

    target.addEventListener("pointerdown", onWakePointer, capture);
    for (const event of DASHBOARD_IDLE_WAKE_EVENTS) {
      if (event === "pointerdown") continue;
      target.addEventListener(event, onWakeOther, passiveCapture);
    }
    for (const event of DASHBOARD_IDLE_SWALLOWED_EVENTS) {
      target.addEventListener(event, onSwallow, capture);
    }

    return () => {
      target.removeEventListener("pointerdown", onWakePointer, capture);
      for (const event of DASHBOARD_IDLE_WAKE_EVENTS) {
        if (event === "pointerdown") continue;
        target.removeEventListener(event, onWakeOther, passiveCapture);
      }
      for (const event of DASHBOARD_IDLE_SWALLOWED_EVENTS) {
        target.removeEventListener(event, onSwallow, capture);
      }
      clearIdleTimer();
      swallowArmedRef.current = false;
    };
  }, [enabled, target, markActive, clearIdleTimer, setIdle]);

  return enabled ? isIdle : false;
}
