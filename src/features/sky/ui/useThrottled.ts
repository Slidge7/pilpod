import { useCallback, useEffect, useRef } from "react";

/**
 * `fn`, called at most once per `ms` while a value keeps changing (a slider
 * being dragged), always ending on the last value. Each call is a real OS
 * command, so a drag must not queue dozens of them.
 */
export function useThrottled<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const last = useRef(0);
  const pending = useRef<A | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(
    (...args: A) => {
      const wait = ms - (Date.now() - last.current);
      if (wait <= 0 && timer.current === null) {
        last.current = Date.now();
        fnRef.current(...args);
        return;
      }
      pending.current = args;
      if (timer.current !== null) return;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        last.current = Date.now();
        const next = pending.current;
        pending.current = null;
        if (next) fnRef.current(...next);
      }, Math.max(0, wait));
    },
    [ms],
  );
}
