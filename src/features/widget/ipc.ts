import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  WIDGET_STATE_EVENT,
  type WidgetAccent,
  type WidgetPlacement,
  type WidgetState,
} from "./types";

/**
 * The widget's IPC surface — commands and the state subscription.
 *
 * Deliberately React-free. The collapsed widget is plain DOM (see
 * `chip/mountChip.ts`), and the whole point of that is not to have a UI
 * runtime resident in a window that sits on screen all day. Importing React
 * from here, even indirectly, would undo it. The React binding lives one file
 * over in `api.ts`, which the dashboard uses.
 */

export const widgetApi = {
  getState: () => invoke<WidgetState>("widget_get_state"),
  setEnabled: (enabled: boolean) => invoke<void>("widget_set_enabled", { enabled }),
  setPlacement: (placement: WidgetPlacement) =>
    invoke<void>("widget_set_placement", { placement }),
  /** Unpin in place — Rust reads the widget's own position to seed the value. */
  useFreePlacement: () => invoke<void>("widget_use_free_placement"),
  setAccent: (accent: WidgetAccent) => invoke<void>("widget_set_accent", { accent }),
  setSize: (size: number) => invoke<void>("widget_set_size", { size }),
  setExpanded: (expanded: boolean) =>
    invoke<void>("widget_set_expanded", { expanded }),
  setBrowsersOpen: (open: boolean) =>
    invoke<void>("widget_set_browsers_open", { open }),
  openMain: () => invoke<void>("widget_open_main"),
  relayout: () => invoke<void>("widget_relayout"),
};

/**
 * Subscribe to widget state and fetch the current value once.
 *
 * Returns an unsubscribe function. `onState` fires for the initial snapshot
 * and for every broadcast after it, so callers never need a separate
 * initial-render path.
 */
export function watchWidgetState(
  onState: (state: WidgetState) => void,
): () => void {
  let alive = true;
  let unlisten: UnlistenFn | undefined;

  void listen<WidgetState>(WIDGET_STATE_EVENT, (ev) => {
    if (alive) onState(ev.payload);
  }).then((u) => {
    // The caller may have torn down while `listen` was in flight.
    if (alive) unlisten = u;
    else void u();
  });

  void widgetApi
    .getState()
    .then((initial) => {
      if (alive) onState(initial);
    })
    .catch(() => {
      /* not running under Tauri (plain browser dev) — keep defaults */
    });

  return () => {
    alive = false;
    void unlisten?.();
  };
}
