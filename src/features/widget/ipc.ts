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
 * Deliberately React-free. The widget window is plain DOM (see
 * `chip/mountChip.ts`), and the whole point of that is not to have a UI runtime
 * resident in a window that sits on screen all day. Importing React from here,
 * even indirectly, would undo it. The React binding lives one file over in
 * `api.ts`, which the dashboard uses.
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
  /**
   * Hold the chip on screen alongside the dashboard while its settings panel
   * is open, so the corner, colour and size controls preview themselves on the
   * real thing. Broadcasts nothing — it only moves a native window.
   */
  setPreview: (preview: boolean) => invoke<void>("widget_set_preview", { preview }),
  /** Bring the dashboard back. The widget stays on, just off screen. */
  openMain: () => invoke<void>("widget_open_main"),
  /** Send the dashboard away again, leaving the chip in its place. */
  hideMain: () => invoke<void>("widget_hide_main"),
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
