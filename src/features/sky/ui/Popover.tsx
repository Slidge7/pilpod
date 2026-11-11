import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useAnchoredMenu } from "../../vault";

/**
 * Popovers for Sky: anchored to a button, rendered in a portal so cards and
 * scrolling panels never clip them, and placed / closed by the same
 * `useAnchoredMenu` the dashboard's save menu uses (outside click, Escape,
 * follows scroll and resize).
 *
 * The portal target is a layer *inside* the Sky shell rather than
 * `document.body`, so popovers inherit Sky's tokens and theme.
 */

const LayerContext = createContext<HTMLElement | null>(null);

/** Place once inside the shell; popovers render into it. */
export function PopoverLayerProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return (
    <LayerContext.Provider value={node}>
      {children}
      <div ref={setNode} className="sky-layer" />
    </LayerContext.Provider>
  );
}

export function usePopover(size: { width: number; height: number }) {
  return useAnchoredMenu(size);
}

export function Popover({
  open,
  menuRef,
  pos,
  width,
  label,
  children,
  className,
}: {
  open: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  pos: { top: number; left: number };
  width: number;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const layer = useContext(LayerContext);
  if (!open || !layer) return null;
  return createPortal(
    <div
      ref={menuRef}
      role="dialog"
      aria-label={label}
      className={["sky-popover", className].filter(Boolean).join(" ")}
      style={{ top: pos.top, left: pos.left, width }}
    >
      {children}
    </div>,
    layer,
  );
}
