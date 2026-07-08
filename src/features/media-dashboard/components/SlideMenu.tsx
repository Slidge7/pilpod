import { useEffect, useState } from "react";
import "./SlideMenu.css";
import type { AppearanceMode } from "../../../theme/appearance";
import { GlassStrengthSlider } from "../../../shared/ui/GlassStrengthSlider";
import { WALLPAPER_INTERVALS } from "../constants";
import type { WallpaperController } from "../hooks/useWallpaper";
import {
  IconBeaker,
  IconImage,
  IconMoon,
  IconRefresh,
  IconShuffle,
  IconSkipBack,
  IconSkipForward,
  IconStayOnTop,
  IconSun,
  IconTimer,
  IconWidgetMinimize,
} from "../../../shared/ui/icons";

type Props = {
  open: boolean;
  appearance: AppearanceMode;
  alwaysOnTop: boolean;
  widgetEnabled: boolean;
  wallpaper: WallpaperController;
  browserTabCount: number;
  glassStrength: number;
  onGlassStrengthChange: (value: number) => void;
  onClose: () => void;
  onToggleAlwaysOnTop: () => void;
  onToggleAppearance: () => void;
  onRefresh: () => void;
  onToggleWidgetEnabled: () => void;
  onOpenDevLab?: () => void;
};

/** Turn a wallpaper file name into a friendlier label, e.g. "01-aurora.jpg" -> "Aurora". */
function prettyName(name: string | null): string {
  if (!name) return "Off";
  const base = name.replace(/\.[^.]+$/, "").replace(/^\d+[-_ ]?/, "");
  const words = base.replace(/[-_]+/g, " ").trim();
  if (!words) return "Wallpaper";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function SlideMenu({
  open,
  appearance,
  alwaysOnTop,
  widgetEnabled,
  wallpaper,
  browserTabCount,
  glassStrength,
  onGlassStrengthChange,
  onClose,
  onToggleAlwaysOnTop,
  onToggleAppearance,
  onRefresh,
  onToggleWidgetEnabled,
  onOpenDevLab,
}: Props) {
  const [glassDragging, setGlassDragging] = useState(false);
  const [wallpaperExpanded, setWallpaperExpanded] = useState(false);

  useEffect(() => {
    if (!open) {
      setGlassDragging(false);
      setWallpaperExpanded(false);
    }
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
    wallpaper.enabled ? "pilpod-slide-menu__btn--active" : "",
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
  const btnTabIndex = open ? 0 : -1;
  const wpTabIndex = open && wallpaperExpanded ? 0 : -1;
  const noWallpapers = wallpaper.names.length === 0;

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
      <div className="pilpod-slide-menu__panel">
        <div className="pilpod-slide-menu__actions">
          <button
            type="button"
            onClick={onToggleAlwaysOnTop}
            className={pinClass}
            title={alwaysOnTop ? "Unpin window" : "Pin window (always on top)"}
            aria-label={alwaysOnTop ? "Unpin window" : "Pin window"}
            aria-pressed={alwaysOnTop}
            tabIndex={btnTabIndex}
          >
            <IconStayOnTop />
          </button>
          <button
            type="button"
            onClick={onToggleAppearance}
            className="pilpod-slide-menu__btn"
            title={appearanceTitle}
            aria-label={appearanceTitle}
            tabIndex={btnTabIndex}
          >
            {appearance === "dark" ? <IconSun /> : <IconMoon />}
          </button>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="pilpod-slide-menu__btn"
            title="Refresh"
            aria-label="Refresh"
            tabIndex={btnTabIndex}
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
            tabIndex={btnTabIndex}
          >
            <IconWidgetMinimize />
          </button>
          <button
            type="button"
            onClick={() => setWallpaperExpanded((v) => !v)}
            className={wallpaperBtnClass}
            title="Wallpaper options"
            aria-label="Wallpaper options"
            aria-expanded={wallpaperExpanded}
            aria-pressed={wallpaper.enabled}
            tabIndex={btnTabIndex}
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
              tabIndex={btnTabIndex}
            >
              <IconBeaker />
            </button>
          ) : null}
        </div>

        <div className="pilpod-slide-menu__glass-row">
          <span className="pilpod-slide-menu__glass-label">Glass effect</span>
          {glassSlider}
        </div>

        {wallpaperExpanded ? (
          <div
            className="pilpod-wallpaper-panel"
            role="group"
            aria-label="Wallpaper options"
          >
            <div className="pilpod-wallpaper-panel__top">
              <button
                type="button"
                className="pilpod-wallpaper-panel__nav"
                onClick={wallpaper.prev}
                disabled={noWallpapers}
                title="Previous wallpaper"
                aria-label="Previous wallpaper"
                tabIndex={wpTabIndex}
              >
                <IconSkipBack />
              </button>
              <span
                className="pilpod-wallpaper-panel__name"
                title={wallpaper.current ?? "Wallpaper off"}
              >
                {noWallpapers ? "No wallpapers" : prettyName(wallpaper.current)}
              </span>
              <button
                type="button"
                className="pilpod-wallpaper-panel__nav"
                onClick={wallpaper.next}
                disabled={noWallpapers}
                title="Next wallpaper"
                aria-label="Next wallpaper"
                tabIndex={wpTabIndex}
              >
                <IconSkipForward />
              </button>
            </div>

            <div className="pilpod-wallpaper-panel__toggles">
              <button
                type="button"
                className={[
                  "pilpod-wallpaper-panel__toggle",
                  wallpaper.enabled
                    ? "pilpod-wallpaper-panel__toggle--active"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={wallpaper.toggleEnabled}
                disabled={noWallpapers}
                aria-pressed={wallpaper.enabled}
                title={wallpaper.enabled ? "Turn wallpaper off" : "Turn wallpaper on"}
                tabIndex={wpTabIndex}
              >
                <IconImage />
                <span>{wallpaper.enabled ? "On" : "Off"}</span>
              </button>
              <button
                type="button"
                className={[
                  "pilpod-wallpaper-panel__toggle",
                  wallpaper.random
                    ? "pilpod-wallpaper-panel__toggle--active"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={wallpaper.toggleRandom}
                aria-pressed={wallpaper.random}
                title={wallpaper.random ? "Random order: on" : "Random order: off"}
                tabIndex={wpTabIndex}
              >
                <IconShuffle />
                <span>Random</span>
              </button>
              <button
                type="button"
                className={[
                  "pilpod-wallpaper-panel__toggle",
                  wallpaper.autoSwitch
                    ? "pilpod-wallpaper-panel__toggle--active"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={wallpaper.toggleAutoSwitch}
                aria-pressed={wallpaper.autoSwitch}
                title={wallpaper.autoSwitch ? "Auto-switch: on" : "Auto-switch: off"}
                tabIndex={wpTabIndex}
              >
                <IconTimer />
                <span>Auto</span>
              </button>
            </div>

            {wallpaper.autoSwitch ? (
              <div
                className="pilpod-wallpaper-panel__intervals"
                role="group"
                aria-label="Auto-switch interval"
              >
                {WALLPAPER_INTERVALS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={[
                      "pilpod-wallpaper-panel__chip",
                      wallpaper.intervalId === opt.id
                        ? "pilpod-wallpaper-panel__chip--active"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => wallpaper.setIntervalId(opt.id)}
                    aria-pressed={wallpaper.intervalId === opt.id}
                    title={`Switch every ${opt.label}`}
                    tabIndex={wpTabIndex}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="pilpod-slide-menu__footer">
          <div className="pilpod-slide-menu__footer-left">
            <img
              src="/pilpod-icon.png"
              alt=""
              width={14}
              height={14}
              className="pilpod-slide-menu__footer-logo"
              aria-hidden
            />
            <span className="pilpod-slide-menu__footer-title">PilPod</span>
            <span className="pilpod-slide-menu__credit">Provided by s7.ma</span>
          </div>
          <span className="pilpod-slide-menu__stats">
            {browserTabCount} browser tabs
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
