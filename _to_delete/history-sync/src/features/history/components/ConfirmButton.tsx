import { useEffect, useState, type ReactNode } from "react";

const ARMED_MS = 3000;

/**
 * Two-step destructive button: the first click arms it (label switches to
 * `confirmLabel`), a second click within three seconds fires. No modal, no
 * accidental wipes.
 */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  className,
  title,
}: {
  children: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  className?: string;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARMED_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={[className, armed ? "pilpod-history-confirm--armed" : ""].filter(Boolean).join(" ")}
      title={title}
      aria-live="polite"
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
