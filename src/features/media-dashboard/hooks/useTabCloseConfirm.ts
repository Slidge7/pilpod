import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

export const TAB_CLOSE_CONFIRM_RESET_MS = 2800;

type Options = {
  onClose: () => void;
  /** Called before toggling confirm (e.g. cancel slide menu timers). */
  onBeforeInteract?: () => void;
};

export function useTabCloseConfirm({ onClose, onBeforeInteract }: Options) {
  const [closeConfirm, setCloseConfirm] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetCloseConfirm = useCallback(() => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setCloseConfirm(false);
  }, []);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const handleClose = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onBeforeInteract?.();
      if (!closeConfirm) {
        setCloseConfirm(true);
        confirmTimerRef.current = setTimeout(() => {
          confirmTimerRef.current = null;
          setCloseConfirm(false);
        }, TAB_CLOSE_CONFIRM_RESET_MS);
      } else {
        resetCloseConfirm();
        onClose();
      }
    },
    [closeConfirm, onClose, onBeforeInteract, resetCloseConfirm],
  );

  const closeTitle = closeConfirm ? "Click again to close" : "Close tab";

  return {
    closeConfirm,
    handleClose,
    closeTitle,
    resetCloseConfirm,
  };
}
