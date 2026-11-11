import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { SectionId } from "./route";

/**
 * Lets a section put its own controls in the shared sidebar (the browser list
 * for Live, collections for Bookmarks, …) while keeping that UI — and the
 * state it shares with the section's main area — inside the section's module.
 * The shell provides one slot; only the visible section renders into it.
 */

type SlotApi = {
  node: HTMLElement | null;
  setNode: (node: HTMLElement | null) => void;
};

const SlotContext = createContext<SlotApi | null>(null);

type Scope = { id: SectionId; active: boolean };
const ScopeContext = createContext<Scope | null>(null);

export function SidebarSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return (
    <SlotContext.Provider value={{ node, setNode }}>{children}</SlotContext.Provider>
  );
}

/** Where section sidebars render. Placed once by the shell's sidebar. */
export function SidebarSlotTarget({ className }: { className?: string }) {
  const slot = useContext(SlotContext);
  return <div ref={slot?.setNode} className={className} />;
}

/** Wraps each mounted section; tells it whether it is the visible one. */
export function SectionScope({
  id,
  active,
  children,
}: Scope & { children: ReactNode }) {
  return <ScopeContext.Provider value={{ id, active }}>{children}</ScopeContext.Provider>;
}

export function useSectionActive(): boolean {
  return useContext(ScopeContext)?.active ?? true;
}

/** Render `children` into the shared sidebar while this section is visible. */
export function SectionSidebar({ children }: { children: ReactNode }) {
  const slot = useContext(SlotContext);
  const active = useSectionActive();
  if (!slot?.node || !active) return null;
  return createPortal(children, slot.node);
}
