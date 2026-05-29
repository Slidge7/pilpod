import "./DashboardHeader.css";
import {
  IconClose,
  IconMenu,
  IconMinimize,
} from "../../../shared/ui/icons";

type Props = {
  menuOpen: boolean;
  widgetEnabled: boolean;
  onToggleMenu: () => void;
  onMinimize: () => void;
  onClose: () => void;
};

export function DashboardHeader({
  menuOpen,
  widgetEnabled,
  onToggleMenu,
  onMinimize,
  onClose,
}: Props) {
  const minimizeTitle = widgetEnabled
    ? "Minimize to floating widget"
    : "Minimize to taskbar";

  const menuBtnClass = [
    "pilpod-dash-header__menu-toggle",
    menuOpen ? "pilpod-dash-header__menu-toggle--open" : "",
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
        <span className="pilpod-dash-header__title">PilPod</span>
      </div>
      <div className="pilpod-dash-header__center">
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
