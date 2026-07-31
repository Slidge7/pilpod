import { useCallback, useEffect, useRef, useState } from "react";
import {
  WIDGET_ACCENTS,
  WIDGET_ACCENT_LABELS,
  WIDGET_CORNER_LABELS,
  WIDGET_SIZE_MAX,
  WIDGET_SIZE_MIN,
  type WidgetController,
  type WidgetCorner,
} from "../../widget";
import { IconWidgetMinimize } from "../../../shared/ui/icons";
import "./WidgetSettingsPanel.css";

type Props = {
  widget: WidgetController;
  /** -1 while the menu is closed, so the panel stays out of the tab order. */
  tabIndex: number;
};

/**
 * Corners in screen reading order. The grid is laid out to match, so the
 * buttons form a literal picture of the screen — the top-left button is in the
 * top-left of the control.
 */
const CORNER_GRID: readonly WidgetCorner[] = [
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
];

/**
 * Appearance and placement controls for the floating widget.
 *
 * Every control here writes straight through to Rust, which moves or repaints
 * the live window and broadcasts the result. There is no Apply button and no
 * local draft state: clicking a corner, a colour or dragging the size slider
 * *is* the preview, because the widget on screen and this panel are rendering
 * the same value.
 *
 * Turning the widget on shows it immediately, whatever the main window is
 * doing. The widget is no longer something you get by minimizing the app.
 */
export function WidgetSettingsPanel({ widget, tabIndex }: Props) {
  const {
    enabled,
    placement,
    accent,
    size,
    toggleEnabled,
    pinToCorner,
    setFree,
    setAccent,
    setSize,
  } = widget;

  const isFree = placement.mode === "free";
  const activeCorner = placement.mode === "corner" ? placement.corner : null;
  const innerTabIndex = enabled ? tabIndex : -1;

  /**
   * Size is the one control that fires continuously.
   *
   * Every step resizes and re-places a real OS window, so sending one command
   * per `input` event would queue dozens of relayouts during a single drag and
   * make the slider feel like it is fighting back. Instead the thumb renders
   * from a local draft (so it tracks the pointer at full rate) and at most one
   * command is sent per animation frame. The draft clears once the broadcast
   * catches up, handing control back to the shared state.
   */
  const [draftSize, setDraftSize] = useState<number | null>(null);
  const frame = useRef<number | null>(null);
  const queued = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  useEffect(() => {
    if (draftSize !== null && Math.round(size) === draftSize) setDraftSize(null);
  }, [size, draftSize]);

  const pushSize = useCallback(
    (next: number) => {
      setDraftSize(next);
      queued.current = next;
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const value = queued.current;
        queued.current = null;
        if (value !== null) setSize(value);
      });
    },
    [setSize],
  );

  const shownSize = draftSize ?? Math.round(size);

  return (
    <div
      className="pilpod-widget-settings"
      role="group"
      aria-label="Floating widget options"
    >
      <div className="pilpod-widget-settings__row">
        <button
          type="button"
          className={[
            "pilpod-widget-settings__toggle",
            enabled ? "pilpod-widget-settings__toggle--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={toggleEnabled}
          aria-pressed={enabled}
          title={
            enabled
              ? "Hide the floating widget"
              : "Show the floating widget — it stays on screen whether PilPod is open or minimized"
          }
          tabIndex={tabIndex}
        >
          <IconWidgetMinimize />
          <span>{enabled ? "Widget on" : "Widget off"}</span>
        </button>
      </div>

      <fieldset className="pilpod-widget-settings__group" disabled={!enabled}>
        <legend className="pilpod-widget-settings__legend">Position</legend>

        <div className="pilpod-widget-settings__modes">
          <button
            type="button"
            className={[
              "pilpod-widget-settings__mode",
              isFree ? "pilpod-widget-settings__mode--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={setFree}
            aria-pressed={isFree}
            title="Free — unpin the widget in place, then drag it anywhere"
            tabIndex={innerTabIndex}
          >
            Free
          </button>
          <button
            type="button"
            className={[
              "pilpod-widget-settings__mode",
              activeCorner ? "pilpod-widget-settings__mode--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => pinToCorner(activeCorner ?? "bottomRight")}
            aria-pressed={activeCorner != null}
            title="Corner — pin the widget flush to a screen corner"
            tabIndex={innerTabIndex}
          >
            Corner
          </button>
        </div>

        {/* The grid is a miniature of the screen: press where you want it. */}
        <div
          className="pilpod-widget-settings__corners"
          role="group"
          aria-label="Screen corner"
          data-dimmed={isFree ? "true" : undefined}
        >
          {CORNER_GRID.map((corner) => (
            <button
              key={corner}
              type="button"
              className={[
                "pilpod-widget-settings__corner",
                activeCorner === corner ? "pilpod-widget-settings__corner--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-corner={corner}
              onClick={() => pinToCorner(corner)}
              aria-pressed={activeCorner === corner}
              aria-label={WIDGET_CORNER_LABELS[corner]}
              title={`Pin to ${WIDGET_CORNER_LABELS[corner].toLowerCase()}`}
              tabIndex={innerTabIndex}
            >
              {/* Mirrors the real widget: a triangle in the matching corner. */}
              <span className="pilpod-widget-settings__corner-tri" aria-hidden="true" />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="pilpod-widget-settings__group" disabled={!enabled}>
        <legend className="pilpod-widget-settings__legend">Colour</legend>
        {/*
          The swatches take the shape the widget currently has — triangle when
          pinned, sphere when free — so the picker previews the real thing
          rather than a generic colour chip.
        */}
        <div
          className="pilpod-widget-settings__accents"
          role="group"
          aria-label="Widget colour"
          data-shape={isFree ? "bubble" : "corner"}
        >
          {WIDGET_ACCENTS.map((option) => (
            <button
              key={option}
              type="button"
              className={[
                "pilpod-widget-settings__accent",
                accent === option ? "pilpod-widget-settings__accent--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-accent={option}
              onClick={() => setAccent(option)}
              aria-pressed={accent === option}
              aria-label={WIDGET_ACCENT_LABELS[option]}
              title={WIDGET_ACCENT_LABELS[option]}
              tabIndex={innerTabIndex}
            >
              {/* The swatch is the same glass triangle, in miniature. */}
              <span className="pilpod-widget-settings__accent-tri" aria-hidden="true" />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="pilpod-widget-settings__group" disabled={!enabled}>
        <legend className="pilpod-widget-settings__legend">Size</legend>
        <div className="pilpod-widget-settings__size">
          <input
            type="range"
            className="pilpod-widget-settings__size-input"
            min={WIDGET_SIZE_MIN}
            max={WIDGET_SIZE_MAX}
            step={1}
            value={shownSize}
            aria-label="Widget size"
            aria-valuemin={WIDGET_SIZE_MIN}
            aria-valuemax={WIDGET_SIZE_MAX}
            aria-valuenow={shownSize}
            tabIndex={innerTabIndex}
            onChange={(e) => {
              const n = Number(e.target.value);
              // The backend clamps too; this just avoids a pointless
              // round-trip for a value the input should never produce.
              if (!Number.isFinite(n)) return;
              pushSize(n);
            }}
          />
          <span className="pilpod-widget-settings__size-value" aria-hidden="true">
            {shownSize}
          </span>
        </div>
      </fieldset>

      {widget.error ? (
        <p className="pilpod-widget-settings__error">{widget.error}</p>
      ) : null}
    </div>
  );
}
