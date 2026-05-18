import "./WidgetView.css";
import type { PointerEventHandler } from "react";
import { IconMusicGlyph, IconWidgetClose } from "../../../shared/ui/icons";

type Props = {
  onExpand: () => void;
  onDismissWidget: () => void;
  gestures: {
    onPointerDown: PointerEventHandler<HTMLDivElement>;
    onPointerMove: PointerEventHandler<HTMLDivElement>;
    onPointerUp: PointerEventHandler<HTMLDivElement>;
    onPointerCancel: PointerEventHandler<HTMLDivElement>;
  };
};

export function WidgetView({ onExpand, onDismissWidget, gestures }: Props) {
  return (
    <div className="pilpod-widget-view">
      <button
        type="button"
        className="pilpod-widget-view__dismiss"
        title="Turn off floating widget — minimize to taskbar"
        aria-label="Turn off floating widget and minimize to taskbar"
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          void onDismissWidget();
        }}
      >
        <IconWidgetClose className="pilpod-widget-view__dismiss-icon" />
      </button>
      <div
        className="pilpod-widget-view__hit"
        role="button"
        tabIndex={0}
        aria-label="Show media list — drag to move"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void onExpand();
          }
        }}
        onPointerDown={gestures.onPointerDown}
        onPointerMove={gestures.onPointerMove}
        onPointerUp={gestures.onPointerUp}
        onPointerCancel={gestures.onPointerCancel}
      >
        <div className="pilpod-widget-chip" title="" aria-hidden>
          <IconMusicGlyph className="pilpod-widget-chip__music" />
        </div>
      </div>
    </div>
  );
}
