import { useEffect, useState } from "react";
import { watchWidgetState, type WidgetState } from "../../widget";

/**
 * Live, read-only widget state.
 *
 * Deliberately not `useWidgetState`: that hook is the dashboard's editor (it
 * carries setters and a one-time legacy migration). Sky only displays
 * whether the widget is on, so it subscribes to the broadcast and nothing else.
 */
export function useWidgetSnapshot(): WidgetState | null {
  const [state, setState] = useState<WidgetState | null>(null);
  useEffect(() => watchWidgetState(setState), []);
  return state;
}
