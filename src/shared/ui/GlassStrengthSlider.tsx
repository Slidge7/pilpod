import "./GlassStrengthSlider.css";
import { useRef } from "react";
import { IconGlass } from "./icons";

type Props = {
  value: number;
  onChange: (value: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  tabIndex?: number;
};

export function GlassStrengthSlider({
  value,
  onChange,
  onDragStart,
  onDragEnd,
  tabIndex = 0,
}: Props) {
  const draggingRef = useRef(false);

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    onDragEnd?.();
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  };

  const startDrag = () => {
    if (draggingRef.current) return;
    draggingRef.current = true;
    onDragStart?.();
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  };

  const fillClass = [
    "pilpod-glass-strength__fill",
    value >= 85 ? "pilpod-glass-strength__fill--high" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="pilpod-glass-strength">
      <span className="pilpod-glass-strength__icon" aria-hidden>
        <IconGlass className="pilpod-glass-strength__icon-svg" />
      </span>
      <div className="pilpod-glass-strength__track">
        <div className="pilpod-glass-strength__rail" />
        <div className={fillClass} style={{ width: `${value}%` }} />
        <div
          className="pilpod-glass-strength__thumb"
          style={{ left: `${value}%` }}
        />
        <input
          type="range"
          className="pilpod-glass-strength__input"
          min={0}
          max={100}
          step={1}
          value={value}
          tabIndex={tabIndex}
          aria-label="Glass effect strength"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          onPointerDown={startDrag}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(Math.min(100, Math.max(0, n)));
          }}
        />
      </div>
      <span className="pilpod-glass-strength__pct" aria-hidden>
        {value}
      </span>
    </div>
  );
}
