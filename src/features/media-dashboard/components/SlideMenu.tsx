import { useEffect, useState } from "react";
import "./SlideMenu.css";
import type { AppearanceMode } from "../../../theme/appearance";
import { GlassStrengthSlider } from "../../../shared/ui/GlassStrengthSlider";
import {
  IconBeaker,
  IconImage,
  IconMoon,
  IconRefresh,
  IconStayOnTop,
  IconSun,
  IconWidgetMinimize,
} from "../../../shared/ui/icons";

type Props = {
  open: boolean;
  appearance: AppearanceMode;
  alwaysOnTop: boolean;
  widgetEnabled: boolean;
  hasWallpaper: boolean;
  browserTabCount: number;
  sessionCount: number;
  glassStrength: number;
  onGlassStrengthChange: (value: number) => void;
  onClose: () => void;
  onToggleAlwaysOnTop: () => void;
  onToggleAppearance: () => void;
  onRefresh: () => void;
  onToggleWidgetEnabled: () => void;
  onPickWallpaper: () => void;
  onClearWallpaper: () => void;
  onOpenDevLab?: () => void;
};

export function SlideMenu({
  open,
  appearance,
  alwaysOnTop,
  widgetEnabled,
  hasWallpaper,
  browserTabCount,
  sessionCount,
  glassStrength,
  onGlassStrengthChange,
  onClose,
  onToggleAlwaysOnTop,
  onToggleAppearance,
  onRefresh,
  onToggleWidgetEnabled,
  onPickWallpaper,
  onClearWallpaper,
  onOpenDevLab,
}: Props) {
  const [glassDragging, setGlassDragging] = useState(false);

  useEffect(() => {
    if (!open) setGlassDragging(false);
  }, [open]);

  const appearanceTitle =
    appearance === "dark" ? "Use light appearance" : "Use dark appearance";
  const widgetToggleTitle = widgetEnabled
    ? "Floating widget on minimize: on (click to turn off)"
    : "Floating widget on minimize: off (click to turn on)";

  const pinClass = [
    "pilpod-slide-menu__btn",
    alwaysOnTop ? "pilpod-slide-menu__btn--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const widgetBtnClass = [
    "pilpod-slide-menu__btn",
    widgetEnabled ? "pilpod-slide-menu__btn--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const wallpaperBtnClass = [
    "pilpod-slide-menu__btn",
    hasWallpaper ? "pilpod-slide-menu__btn--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const rootClass = [
    "pilpod-slide-menu",
    open ? "pilpod-slide-menu--open" : "",
    glassDragging ? "pilpod-slide-menu--glass-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sliderTabIndex = open ? 0 : -1;

  const glassSlider = (
    <GlassStrengthSlider
      value={glassStrength}
      onChange={onGlassStrengthChange}
      onDragStart={() => setGlassDragging(true)}
      onDragEnd={() => setGlassDragging(false)}
      tabIndex={sliderTabIndex}
    />
  );

  return (
    <div className={rootClass} aria-hidden={!open && !glassDragging}>
      {open && glassDragging ? (
        <div className="pilpod-slide-menu__glass-focus" aria-hidden={false}>
          <div className="pilpod-slide-menu__glass-focus-inner">
            <span className="pilpod-slide-menu__glass-label">Glass effect</span>
            {glassSlider}
          </div>
        </div>
      ) : null}

      <div className="pilpod-slide-menu__panel">
        <div className="pilpod-slide-menu__actions">
          <button
            type="button"
            onClick={onToggleAlwaysOnTop}
            className={pinClass}
            title={alwaysOnTop ? "Unpin window" : "Pin window (always on top)"}
            aria-label={alwaysOnTop ? "Unpin window" : "Pin window"}
            aria-pressed={alwaysOnTop}
            tabIndex={open ? 0 : -1}
          >
            <IconStayOnTop />
          </button>
          <button
            type="button"
            onClick={onToggleAppearance}
            className="pilpod-slide-menu__btn"
            title={appearanceTitle}
            aria-label={appearanceTitle}
            tabIndex={open ? 0 : -1}
          >
            {appearance === "dark" ? <IconSun /> : <IconMoon />}
          </button>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="pilpod-slide-menu__btn"
            title="Refresh"
            aria-label="Refresh"
            tabIndex={open ? 0 : -1}
          >
            <IconRefresh />
          </button>
          <button
            type="button"
            onClick={onToggleWidgetEnabled}
            className={widgetBtnClass}
            title={widgetToggleTitle}
            aria-label={widgetToggleTitle}
            aria-pressed={widgetEnabled}
            tabIndex={open ? 0 : -1}
          >
            <IconWidgetMinimize />
          </button>
          <button
            type="button"
            onClick={hasWallpaper ? onClearWallpaper : onPickWallpaper}
            onContextMenu={(e) => {
              if (hasWallpaper) {
                e.preventDefault();
                onClearWallpaper();
              }
            }}
            className={wallpaperBtnClass}
            title={
              hasWallpaper
                ? "Wallpaper set (click to remove)"
                : "Choose a wallpaper image"
            }
            aria-label={hasWallpaper ? "Remove wallpaper" : "Choose wallpaper"}
            aria-pressed={hasWallpaper}
            tabIndex={open ? 0 : -1}
          >
            <IconImage />
          </button>
          {import.meta.env.DEV && onOpenDevLab ? (
            <button
              type="button"
              onClick={onOpenDevLab}
              className="pilpod-slide-menu__btn"
              title="Open Dev Lab"
              aria-label="Open Dev Lab"
              tabIndex={open ? 0 : -1}
            >
              <IconBeaker />
            </button>
          ) : null}
        </div>

        <div className="pilpod-slide-menu__glass-row">
          <span className="pilpod-slide-menu__glass-label">Glass effect</span>
          {glassSlider}
        </div>

        <div className="pilpod-slide-menu__footer">
          <span className="pilpod-slide-menu__credit">Provided by s7.ma</span>
          <span className="pilpod-slide-menu__stats">
            {browserTabCount} browser · {sessionCount} Windows
          </span>
        </div>
      </div>
      <button
        type="button"
        className="pilpod-slide-menu__backdrop"
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
    </div>
  );
}
