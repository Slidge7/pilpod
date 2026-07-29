import {
  WIDGET_CORNER_LABELS,
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
 * Placement controls for the floating widget.
 *
 * Every control here writes straight through to Rust, which moves the live
 * window and broadcasts the result. There is no Apply button and no local
 * draft state: clicking a corner *is* the preview, because the widget on
 * screen and this panel are rendering the same value.
 *
 * Turning the widget on shows it immediately, whatever the main window is
 * doing. The widget is no longer something you get by minimizing the app.
 */
export function WidgetSettingsPanel({ widget, tabIndex }: Props) {
  const { enabled, placement, toggleEnabled, pinToCorner, setFree } = widget;
  const isFree = placement.mode === "free";
  const activeCorner = placement.mode === "corner" ? placement.corner : null;

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
            tabIndex={enabled ? tabIndex : -1}
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
            tabIndex={enabled ? tabIndex : -1}
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
              tabIndex={enabled ? tabIndex : -1}
            >
              <span className="pilpod-widget-settings__corner-mark" aria-hidden="true" />
            </button>
          ))}
        </div>

        <p className="pilpod-widget-settings__hint">
          {isFree
            ? "Drag the widget anywhere. It remembers where you left it."
            : `Pinned flush to the ${WIDGET_CORNER_LABELS[
                activeCorner ?? "bottomRight"
              ].toLowerCase()} of your screen.`}
        </p>
      </fieldset>

      {widget.error ? (
        <p className="pilpod-widget-settings__error">{widget.error}</p>
      ) : null}
    </div>
  );
}
