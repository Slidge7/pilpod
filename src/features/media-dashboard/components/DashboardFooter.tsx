import "./DashboardFooter.css";
import type { AppearanceMode } from "../../../theme/appearance";
import {
  IconMoon,
  IconRefresh,
  IconSun,
  IconWidgetMinimize,
} from "../../../shared/ui/icons";

type Props = {
  appearance: AppearanceMode;
  widgetEnabled: boolean;
  onToggleAppearance: () => void;
  onRefresh: () => void;
  onToggleWidgetEnabled: () => void;
};

export function DashboardFooter({
  appearance,
  widgetEnabled,
  onToggleAppearance,
  onRefresh,
  onToggleWidgetEnabled,
}: Props) {
  const appearanceTitle =
    appearance === "dark" ? "Use light appearance" : "Use dark appearance";
  const widgetToggleTitle = widgetEnabled
    ? "Floating widget on minimize: on (click to turn off)"
    : "Floating widget on minimize: off (click to turn on)";

  const widgetBtnClass = [
    "pilpod-dash-footer__btn",
    widgetEnabled ? "pilpod-dash-footer__btn--amber" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <footer className="pilpod-dash-footer">
      <p className="pilpod-dash-footer__credit">Provided by s7.ma</p>
      <div className="pilpod-dash-footer__actions">
        <button
          type="button"
          onClick={onToggleAppearance}
          className="pilpod-dash-footer__btn"
          title={appearanceTitle}
          aria-label={appearanceTitle}
        >
          {appearance === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="pilpod-dash-footer__btn"
          title="Refresh"
          aria-label="Refresh"
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
        >
          <IconWidgetMinimize />
        </button>
      </div>
    </footer>
  );
}
