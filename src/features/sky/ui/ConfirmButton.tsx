import type { ReactNode } from "react";
import { useConfirm } from "./useConfirm";

type Props = {
  onConfirm: () => void;
  children: ReactNode;
  /** Shown once armed, e.g. "Remove?". */
  confirmLabel: ReactNode;
  className?: string;
  title?: string;
  /** Accessible name while not armed (icon-only buttons). */
  ariaLabel?: string;
};

/** A destructive button that asks once, inline, before acting. */
export function ConfirmButton({ onConfirm, children, confirmLabel, className, title, ariaLabel }: Props) {
  const { armed, press } = useConfirm(onConfirm);
  return (
    <button
      type="button"
      className={[className, armed ? "is-armed" : ""].filter(Boolean).join(" ")}
      title={armed ? "Press again to confirm" : title}
      aria-label={armed ? "Press again to confirm" : ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        press();
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
