import { useCallback, useEffect, useRef, useState } from "react";
import {
  WIDGET_ACCENTS,
  WIDGET_ACCENT_LABELS,
  WIDGET_CORNER_LABELS,
  WIDGET_SIZE_MAX,
  WIDGET_SIZE_MIN,
  useWidgetState,
  type WidgetCorner,
} from "../../../../widget";
import { Segmented } from "../../../ui/Segmented";
import { SettingRow, SettingsCard, Switch } from "../components/SettingRow";

const CORNER_GRID: readonly WidgetCorner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

/**
 * The floating widget's settings. Every control writes straight through to
 * Rust, which moves or repaints the real chip — and while this page is open
 * the chip is held on screen, so each change is its own preview.
 */
export function WidgetPage({ visible }: { visible: boolean }) {
  const widget = useWidgetState();
  const { enabled, placement, accent, size, setPreview } = widget;
  const isFree = placement.mode === "free";
  const activeCorner = placement.mode === "corner" ? placement.corner : null;

  useEffect(() => {
    if (!visible) return;
    setPreview(true);
    return () => setPreview(false);
  }, [visible, setPreview]);

  // Size fires continuously: draw from a local draft, send at most one
  // command per frame (each one re-places a real OS window).
  const [draft, setDraft] = useState<number | null>(null);
  const frame = useRef<number | null>(null);
  const queued = useRef<number | null>(null);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);
  useEffect(() => {
    if (draft !== null && Math.round(size) === draft) setDraft(null);
  }, [size, draft]);
  const { setSize } = widget;
  const pushSize = useCallback(
    (next: number) => {
      setDraft(next);
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
  const shownSize = draft ?? Math.round(size);

  return (
    <>
      <SettingsCard
        title="When PilPod is away"
        description="A small chip that stays on screen while the dashboard is away. Click it to bring PilPod back."
      >
        <SettingRow
          label="Use the floating widget"
          description="When on, minimizing the dashboard tucks it into the chip, and PilPod keeps running from the tray."
        >
          {(ids) => <Switch checked={enabled} onChange={widget.setEnabled} {...ids} />}
        </SettingRow>
      </SettingsCard>

      <fieldset className="sky-fieldset" disabled={!enabled}>
        <SettingsCard title="Position" description={enabled ? "The chip moves as you choose." : "Turn the widget on to place it."}>
          <SettingRow label="Placement">
            {() => (
              <Segmented<"free" | "corner">
                label="Placement"
                value={isFree ? "free" : "corner"}
                disabled={!enabled}
                options={[
                  { value: "corner", label: "Corner", title: "Pinned flush to a screen corner" },
                  { value: "free", label: "Free", title: "Unpinned where it stands; drag it anywhere" },
                ]}
                onChange={(v) => (v === "free" ? widget.setFree() : widget.pinToCorner(activeCorner ?? "bottomRight"))}
              />
            )}
          </SettingRow>
          <SettingRow label="Corner" description="Press the corner of the screen it should sit in.">
            {() => (
              <div className={`sky-screen${isFree ? " is-dimmed" : ""}`} role="group" aria-label="Screen corner">
                {CORNER_GRID.map((corner) => (
                  <button
                    key={corner}
                    type="button"
                    className="sky-screen__corner"
                    data-corner={corner}
                    aria-pressed={activeCorner === corner}
                    aria-label={WIDGET_CORNER_LABELS[corner]}
                    title={`Pin to ${WIDGET_CORNER_LABELS[corner].toLowerCase()}`}
                    onClick={() => widget.pinToCorner(corner)}
                  >
                    <span className="sky-screen__tri" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </SettingRow>
        </SettingsCard>

        <SettingsCard title="Look">
          <SettingRow label="Colour">
            {() => (
              <div className="sky-swatches" role="radiogroup" aria-label="Widget colour">
                {WIDGET_ACCENTS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={accent === option}
                    className="sky-swatch"
                    data-accent={option}
                    aria-label={WIDGET_ACCENT_LABELS[option]}
                    title={WIDGET_ACCENT_LABELS[option]}
                    onClick={() => widget.setAccent(option)}
                  />
                ))}
              </div>
            )}
          </SettingRow>
          <SettingRow label="Size" description="Edge length of the chip in the shape it has now.">
            {({ labelId }) => (
              <span className="sky-range">
                <input
                  type="range"
                  min={WIDGET_SIZE_MIN}
                  max={WIDGET_SIZE_MAX}
                  step={1}
                  value={shownSize}
                  aria-labelledby={labelId}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) pushSize(n);
                  }}
                />
                <output className="sky-range__value">{shownSize}px</output>
              </span>
            )}
          </SettingRow>
        </SettingsCard>
      </fieldset>

      {widget.error ? <p className="sky-inline-error">{widget.error}</p> : null}
    </>
  );
}
