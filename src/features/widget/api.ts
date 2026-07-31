import { useCallback, useEffect, useState } from "react";
import { watchWidgetState, widgetApi } from "./ipc";
import {
  DEFAULT_WIDGET_STATE,
  type WidgetAccent,
  type WidgetCorner,
  type WidgetPlacement,
  type WidgetState,
} from "./types";

/**
 * React binding over {@link widgetApi} — used by the dashboard menu and by the
 * widget's expanded panel.
 *
 * Setters are fire-and-forget. Rust holds the state, every mutation comes back
 * through the `widget://state` broadcast, and the UI renders from that. There
 * is no optimistic local copy that can disagree with the window on screen,
 * which is what makes the menu's controls a live preview of the real widget
 * rather than a form you submit.
 */

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
async function migrateLegacyEnabled(current: WidgetState): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATED_KEY) === "1") return;
    const legacy = localStorage.getItem(LEGACY_ENABLED_KEY);
    localStorage.setItem(MIGRATED_KEY, "1");
    localStorage.removeItem(LEGACY_ENABLED_KEY);
    if (legacy !== "1" || current.enabled) return;
    await widgetApi.setEnabled(true);
  } catch {
    /* storage unavailable — nothing to migrate */
  }
}

export function useWidgetState() {
  const [state, setState] = useState<WidgetState>(DEFAULT_WIDGET_STATE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let migrated = false;
    const stop = watchWidgetState((next) => {
      setState(next);
      // Runs against the first snapshot only; a flip is corrected by the
      // broadcast that follows it.
      if (!migrated) {
        migrated = true;
        void migrateLegacyEnabled(next);
      }
    });
    return stop;
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

  const setAccent = useCallback(
    (accent: WidgetAccent) => void run(() => widgetApi.setAccent(accent)),
    [run],
  );

  const setSize = useCallback(
    (size: number) => void run(() => widgetApi.setSize(size)),
    [run],
  );

  const setExpanded = useCallback(
    (expanded: boolean) => void run(() => widgetApi.setExpanded(expanded)),
    [run],
  );

  const setBrowsersOpen = useCallback(
    (open: boolean) => void run(() => widgetApi.setBrowsersOpen(open)),
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
    setAccent,
    setSize,
    setExpanded,
    setBrowsersOpen,
  };
}

export type WidgetController = ReturnType<typeof useWidgetState>;
export { widgetApi } from "./ipc";
