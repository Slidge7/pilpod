import "./DashboardHeader.css";
import {
  IconClose,
  IconMinimize,
  IconStayOnTop,
} from "../../../shared/ui/icons";

type Props = {
  browserTabCount: number;
  sessionCount: number;
  alwaysOnTop: boolean;
  widgetEnabled: boolean;
  onToggleAlwaysOnTop: () => void;
  onMinimize: () => void;
  onClose: () => void;
};

export function DashboardHeader({
  browserTabCount,
  sessionCount,
  alwaysOnTop,
  widgetEnabled,
  onToggleAlwaysOnTop,
  onMinimize,
  onClose,
}: Props) {
  const minimizeTitle = widgetEnabled
    ? "Minimize to floating widget"
    : "Minimize to taskbar";

  const pinClass = [
    "pilpod-dash-header__btn",
    "pilpod-dash-header__btn--pin",
    alwaysOnTop ? "pilpod-dash-header__btn--pin-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className="pilpod-dash-header" data-tauri-drag-region="deep">
      <div className="pilpod-dash-header__left">
        <img
          src="/pilpod-icon.png"
          alt=""
          width={24}
          height={24}
          className="pilpod-dash-header__logo"
          aria-hidden
        />
        <div className="pilpod-dash-header__brand">
          <span className="pilpod-dash-header__title">PilPod</span>
          <span className="pilpod-dash-header__stats">
            {browserTabCount} browser · {sessionCount} Windows
          </span>
        </div>
      </div>
      <div className="pilpod-dash-header__actions">
        <button
          type="button"
          onClick={onToggleAlwaysOnTop}
          className={pinClass}
          title={alwaysOnTop ? "Unpin window" : "Pin window (always on top)"}
          aria-label={alwaysOnTop ? "Unpin window" : "Pin window"}
          aria-pressed={alwaysOnTop}
        >
          <IconStayOnTop />
          <span className="pilpod-dash-header__pin-label">Pin</span>
        </button>
        <button
          type="button"
          onClick={onMinimize}
          className="pilpod-dash-header__btn"
          title={minimizeTitle}
          aria-label={minimizeTitle}
        >
          <IconMinimize />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="pilpod-dash-header__btn pilpod-dash-header__btn--close"
          title="Close"
          aria-label="Close"
        >
          <IconClose />
        </button>
      </div>
    </header>
  );
}
