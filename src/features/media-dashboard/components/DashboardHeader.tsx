import "./DashboardHeader.css";
import {
  IconClose,
  IconMenu,
  IconMinimize,
  IconStayOnTop,
  IconWidgetMinimize,
} from "../../../shared/ui/icons";

type Props = {
  menuOpen: boolean;
  widgetEnabled: boolean;
  alwaysOnTop: boolean;
  onToggleMenu: () => void;
  onToggleAlwaysOnTop: () => void;
  onToggleWidget: () => void;
  onPrevWallpaper: () => void;
  onNextWallpaper: () => void;
  onMinimize: () => void;
  onClose: () => void;
};

export function DashboardHeader({
  menuOpen,
  widgetEnabled,
  alwaysOnTop,
  onToggleMenu,
  onToggleAlwaysOnTop,
  onToggleWidget,
  onPrevWallpaper,
  onNextWallpaper,
  onMinimize,
  onClose,
}: Props) {
  const minimizeTitle = widgetEnabled
    ? "Minimize to floating widget"
    : "Minimize to taskbar";

  // Pressing this while the widget is off is a bigger move than it looks: the
  // window becomes a flyout and PilPod starts living in the corner. Say that,
  // rather than labelling it "widget" and letting the user find out.
  const widgetTitle = widgetEnabled
    ? "Turn the widget off — PilPod goes back to being an ordinary window"
    : "Turn the widget on — this window stays until you click away, then PilPod lives as a chip in the corner";

  const menuBtnClass = [
    "pilpod-dash-header__menu-toggle",
    menuOpen ? "pilpod-dash-header__menu-toggle--open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const pinClass = [
    "pilpod-dash-header__pin",
    alwaysOnTop ? "pilpod-dash-header__pin--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Same shape as the pin — the two are a pair of window-behaviour switches,
  // and sit together at the left end of the header for that reason.
  const widgetClass = [
    "pilpod-dash-header__pin",
    "pilpod-dash-header__widget",
    widgetEnabled ? "pilpod-dash-header__pin--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className="pilpod-dash-header" data-tauri-drag-region="deep">
      <div className="pilpod-dash-header__left">
        <button
          type="button"
          onClick={onToggleAlwaysOnTop}
          className={pinClass}
          title={alwaysOnTop ? "Unpin window" : "Pin window (always on top)"}
          aria-label={alwaysOnTop ? "Unpin window" : "Pin window"}
          aria-pressed={alwaysOnTop}
        >
          <IconStayOnTop />
        </button>
        <button
          type="button"
          onClick={onToggleWidget}
          className={widgetClass}
          title={widgetTitle}
          aria-label={widgetEnabled ? "Turn the widget off" : "Turn the widget on"}
          aria-pressed={widgetEnabled}
        >
          <IconWidgetMinimize />
        </button>
      </div>
      <div className="pilpod-dash-header__center">
        <button
          type="button"
          onClick={onPrevWallpaper}
          className="pilpod-dash-header__wp-nav pilpod-dash-header__wp-nav--prev"
          title="Previous wallpaper"
          aria-label="Previous wallpaper"
        >
        </button>
        <button
          type="button"
          onClick={onToggleMenu}
          className={menuBtnClass}
          title={menuOpen ? "Close menu" : "Open menu"}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          <IconMenu />
        </button>
        <button
          type="button"
          onClick={onNextWallpaper}
          className="pilpod-dash-header__wp-nav pilpod-dash-header__wp-nav--next"
          title="Next wallpaper"
          aria-label="Next wallpaper"
        >
        </button>
      </div>
      <div className="pilpod-dash-header__actions">
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
