import type { AppearanceMode } from "../../../../../theme/appearance";
import { useAppearance, useGlassAppearance } from "../../../../media-dashboard";
import { useAlwaysOnTopSetting } from "../hooks/useAlwaysOnTopSetting";
import { SettingRow, SettingsCard, Switch } from "../components/SettingRow";

const THEMES: ReadonlyArray<{ mode: AppearanceMode; label: string; hint: string }> = [
  { mode: "light", label: "Light", hint: "Bright panels, dark text" },
  { mode: "dark", label: "Dark", hint: "Deep panels, light text" },
];

/** Theme for every PilPod window, plus how the dashboard window looks and sits. */
export function AppearancePage() {
  const { appearance, setAppearance } = useAppearance();
  const { glassStrength, setGlassStrength } = useGlassAppearance();
  const { alwaysOnTop, setAlwaysOnTop } = useAlwaysOnTopSetting();

  return (
    <>
      <SettingsCard title="Theme" description="Applies to the dashboard, PilPod Sky and the player window.">
        <div className="sky-themes" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.mode}
              type="button"
              role="radio"
              aria-checked={appearance === t.mode}
              className={`sky-theme sky-theme--${t.mode}`}
              onClick={() => setAppearance(t.mode)}
            >
              <span className="sky-theme__preview" aria-hidden="true">
                <span className="sky-theme__bar" />
                <span className="sky-theme__side" />
                <span className="sky-theme__card" />
                <span className="sky-theme__card sky-theme__card--b" />
              </span>
              <span className="sky-theme__text">
                <span className="sky-theme__label">{t.label}</span>
                <span className="sky-theme__hint">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Dashboard window">
        <SettingRow
          label="Glass effect"
          description="How much the dashboard’s panels let the wallpaper show through. Lower is easier to read."
        >
          {({ labelId, descriptionId }) => (
            <span className="sky-range">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={glassStrength}
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                onChange={(e) => setGlassStrength(Number(e.target.value))}
              />
              <output className="sky-range__value">{glassStrength}%</output>
            </span>
          )}
        </SettingRow>
        <SettingRow
          label="Keep on top"
          description="The dashboard stays above other windows. It steps back on its own when you open a tab in a browser."
        >
          {(ids) => <Switch checked={alwaysOnTop} onChange={setAlwaysOnTop} {...ids} />}
        </SettingRow>
      </SettingsCard>
    </>
  );
}
