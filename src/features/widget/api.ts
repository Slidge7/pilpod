import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  DEFAULT_WIDGET_STATE,
  WIDGET_STATE_EVENT,
  type WidgetCorner,
  type WidgetPlacement,
  type WidgetState,
} from "./types";

/**
 * Typed wrappers around the widget's IPC surface, plus the hook both windows
 * use to stay in sync.
 *
 * Nothing here caches or derives: Rust holds the state, every mutation returns
 * through the `widget://state` broadcast, and both the dashboard menu and the
 * widget window render straight from it. That is what makes picking a corner
 * in the menu move the live widget with no extra wiring — there is only one
 * copy of the truth to update.
 */

export const widgetApi = {
  getState: () => invoke<WidgetState>("widget_get_state"),
  setEnabled: (enabled: boolean) => invoke<void>("widget_set_enabled", { enabled }),
  setPlacement: (placement: WidgetPlacement) =>
    invoke<void>("widget_set_placement", { placement }),
  /** Unpin in place — Rust reads the widget's own position to seed the value. */
  useFreePlacement: () => invoke<void>("widget_use_free_placement"),
  setExpanded: (expanded: boolean) =>
    invoke<void>("widget_set_expanded", { expanded }),
  openMain: () => invoke<void>("widget_open_main"),
  relayout: () => invoke<void>("widget_relayout"),
};

/** Legacy key: the widget's on/off flag lived in localStorage before Rust owned it. */
const LEGACY_ENABLED_KEY = "pilpod-widget-enabled";
const MIGRATED_KEY = "pilpod-widget-migrated";

/**
 * Carry the pre-refactor "widget on" preference into the Rust store, once.
 *
 * Cheap to do and it means the refactor is invisible to anyone who already had
 * the widget turned on. The marker key stops it from re-enabling the widget
 * every launch for someone who has since turned it off.
 */
async function migrateLegacyEnabled(current: WidgetState): Promise<boolean> {
  try {
    if (localStorage.getItem(MIGRATED_KEY) === "1") return false;
    const legacy = localStorage.getItem(LEGACY_ENABLED_KEY);
    localStorage.setItem(MIGRATED_KEY, "1");
    localStorage.removeItem(LEGACY_ENABLED_KEY);
    if (legacy !== "1" || current.enabled) return false;
    await widgetApi.setEnabled(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribe to widget state.
 *
 * Mounts one event listener per window and one initial fetch. Setters are
 * fire-and-forget: the resulting broadcast is what updates the UI, so there is
 * no optimistic local copy that can disagree with the window on screen.
 */
export function useWidgetState() {
  const [state, setState] = useState<WidgetState>(DEFAULT_WIDGET_STATE);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let unlisten: UnlistenFn | undefined;

    void listen<WidgetState>(WIDGET_STATE_EVENT, (ev) => {
      if (alive.current) setState(ev.payload);
    }).then((u) => {
      // The component may have unmounted while `listen` was in flight.
      if (alive.current) unlisten = u;
      else void u();
    });

    void widgetApi
      .getState()
      .then(async (initial) => {
        if (!alive.current) return;
        setState(initial);
        // If migration flips the flag, the broadcast will correct us.
        await migrateLegacyEnabled(initial);
      })
      .catch(() => {
        /* not running under Tauri (plain browser dev) — keep defaults */
      });

    return () => {
      alive.current = false;
      void unlisten?.();
    };
  }, []);

  const run = useCallback(async (op: () => Promise<void>) => {
    try {
      await op();
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => void run(() => widgetApi.setEnabled(enabled)),
    [run],
  );

  const toggleEnabled = useCallback(
    () => void run(() => widgetApi.setEnabled(!state.enabled)),
    [run, state.enabled],
  );

  const setPlacement = useCallback(
    (placement: WidgetPlacement) => void run(() => widgetApi.setPlacement(placement)),
    [run],
  );

  const pinToCorner = useCallback(
    (corner: WidgetCorner) =>
      void run(() => widgetApi.setPlacement({ mode: "corner", corner })),
    [run],
  );

  /**
   * Switch to free placement, leaving the widget where it stands.
   *
   * The seed position is read natively rather than here: this hook also runs
   * in the dashboard window, which can only measure *its own* geometry. Asking
   * Rust means the answer is right from either caller.
   */
  const setFree = useCallback(
    () => void run(() => widgetApi.useFreePlacement()),
    [run],
  );

  const setExpanded = useCallback(
    (expanded: boolean) => void run(() => widgetApi.setExpanded(expanded)),
    [run],
  );

  return {
    ...state,
    error,
    setEnabled,
    toggleEnabled,
    setPlacement,
    pinToCorner,
    setFree,
    setExpanded,
  };
}

export type WidgetController = ReturnType<typeof useWidgetState>;
