import { useCallback, useEffect, useRef, useState } from "react";

const RESET_MS = 3000;

/**
 * Two-step confirmation for destructive buttons: the first press arms it,
 * the second (within a few seconds) runs `action`. No modal, no surprise.
 */
export function useConfirm(action: () => void) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const press = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (armed) {
      timer.current = null;
      setArmed(false);
      actionRef.current();
      return;
    }
    setArmed(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setArmed(false);
    }, RESET_MS);
  }, [armed]);

  return { armed, press };
}
