import { Suspense, lazy, useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWidgetState } from "./api";
import { WidgetChip } from "./components/WidgetChip";
import "./WidgetApp.css";

/**
 * Root of the widget's own window.
 *
 * ## Why this is a separate window
 *
 * The widget used to be the main window shrunk to a chip, which is why it
 * behaved like an attachment of the app: it appeared on minimize and vanished
 * on restore because those were the same window. It now has its own OS window
 * and its own document, so nothing the user does to the dashboard — minimize,
 * restore, focus, close the menu — reaches it. It appears when toggled on and
 * stays until toggled off.
 *
 * ## Why the panel is lazy
 *
 * A window that is always on screen should idle cheaply. Collapsed, this tree
 * is the chip plus one event subscription. The media list, the browser-session
 * components and their icons live in a separate chunk that is fetched the
 * first time the user expands — and it is fetched from disk in a packaged app,
 * so the delay is a frame, not a network round-trip.
 */
const WidgetPanel = lazy(() =>
  import("./components/WidgetPanel").then((m) => ({ default: m.WidgetPanel })),
);

/** Ignore blur for a moment after expanding: the resize itself churns focus. */
const EXPAND_BLUR_GRACE_MS = 280;

export function WidgetApp() {
  const widget = useWidgetState();
  const { expanded, placement, setExpanded, setEnabled } = widget;

  // Read in a native event callback, so refs rather than deps.
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const graceUntil = useRef(0);

  const expand = useCallback(() => {
    graceUntil.current = Date.now() + EXPAND_BLUR_GRACE_MS;
    setExpanded(true);
  }, [setExpanded]);

  const collapse = useCallback(() => setExpanded(false), [setExpanded]);
  const dismiss = useCallback(() => setEnabled(false), [setEnabled]);

  // Click-away: an expanded panel that loses focus collapses back to the chip,
  // the way a menu would. Bound once for the window's lifetime — re-binding it
  // per state change would drop events during the swap.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;

    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused || !expandedRef.current) return;
        if (Date.now() < graceUntil.current) return;
        void setExpanded(false);
      })
      .then((u) => {
        if (alive) unlisten = u;
        else void u();
      });

    return () => {
      alive = false;
      void unlisten?.();
    };
  }, [setExpanded]);

  // Escape collapses, matching the click-away affordance.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, collapse]);

  if (!expanded) {
    // The chip has no dismiss control of its own — at logo size there is no
    // room for one that isn't fighting the logo's hit target. Turning the
    // widget off lives in the menu, beside the controls that placed it.
    return (
      <div className="pilpod-widget-window">
        <WidgetChip placement={placement} onExpand={expand} />
      </div>
    );
  }

  return (
    <div className="pilpod-widget-window">
      <Suspense
        fallback={
          <div className="pilpod-widget-window__loading" role="status" aria-live="polite">
            <span className="pilpod-widget-window__spinner" aria-hidden="true" />
            <span className="pilpod-widget-window__loading-text">Loading media…</span>
          </div>
        }
      >
        <WidgetPanel onCollapse={collapse} onDismiss={dismiss} />
      </Suspense>
    </div>
  );
}
