import { useAppearance } from "../../../../media-dashboard";
import {
  WALLPAPER_INTERVALS,
  prettyWallpaperName,
  useWallpaperSettings,
  type WallpaperIntervalId,
  type WallpaperSource,
} from "../../../../media-dashboard";
import {
  IconFolderOpen,
  IconImage,
  IconSkipBack,
  IconSkipForward,
} from "../../../../../shared/ui/icons";
import { ConfirmButton } from "../../../ui/ConfirmButton";
import { plural } from "../../../ui/format";
import { Segmented } from "../../../ui/Segmented";
import { SettingRow, SettingsCard, Switch } from "../components/SettingRow";
import { WallpaperTile, useWallpaperPreview } from "../components/WallpaperTile";

const SOURCES: ReadonlyArray<{ value: WallpaperSource; label: string; title: string }> = [
  { value: "default", label: "Built-in", title: "PilPod’s wallpapers, with a light and a dark version of each" },
  { value: "custom", label: "Your images", title: "Your own pictures, the same in light and dark" },
];

/**
 * The dashboard's wallpaper, set up from Sky. Sky itself never shows it: this
 * page edits the shared preferences (see `useWallpaperSettings`) and the
 * dashboard picks every change up live.
 */
export function WallpaperPage() {
  const wp = useWallpaperSettings();
  const { appearance } = useAppearance();
  const hero = useWallpaperPreview(wp.source, wp.current, appearance, true);
  const empty = wp.names.length === 0;

  return (
    <>
      <section className="sky-wp-hero" aria-label="Current dashboard wallpaper">
        <div className={`sky-wp-hero__frame${wp.enabled ? "" : " is-off"}`}>
          {hero.url && wp.enabled ? (
            <img src={hero.url} alt="" draggable={false} />
          ) : (
            <span className="sky-wp-hero__placeholder">
              <IconImage />
              {wp.enabled ? "Loading preview…" : "No wallpaper — the dashboard uses its plain background"}
            </span>
          )}
          <span className="sky-wp-hero__badge">Dashboard</span>
        </div>
        <div className="sky-wp-hero__info">
          <p className="sky-wp-hero__kicker">Behind the dashboard</p>
          <h3 className="sky-wp-hero__name">{wp.enabled ? prettyWallpaperName(wp.currentLabel) : "Off"}</h3>
          <p className="sky-wp-hero__note">
            PilPod Sky keeps its plain background so tabs and text stay easy to read. The wallpaper only
            appears in the dashboard.
          </p>
          <div className="sky-wp-hero__controls">
            <button
              type="button"
              className="sky-icon-btn sky-icon-btn--lg"
              onClick={wp.prev}
              disabled={empty}
              title="Previous wallpaper"
              aria-label="Previous wallpaper"
            >
              <IconSkipBack />
            </button>
            <button
              type="button"
              className="sky-icon-btn sky-icon-btn--lg"
              onClick={wp.next}
              disabled={empty}
              title="Next wallpaper"
              aria-label="Next wallpaper"
            >
              <IconSkipForward />
            </button>
            <label className="sky-wp-hero__toggle">
              <input
                type="checkbox"
                role="switch"
                className="sky-switch"
                checked={wp.enabled}
                disabled={empty}
                onChange={wp.toggleEnabled}
              />
              Show a wallpaper
            </label>
          </div>
        </div>
      </section>

      <SettingsCard
        title="Images"
        description={
          wp.source === "default"
            ? "Each built-in wallpaper has a light and a dark version; the dashboard uses the one that matches its theme."
            : "Your pictures are shown as they are in both themes. Large photos are scaled to your screen."
        }
        aside={
          <Segmented<WallpaperSource>
            label="Wallpaper source"
            value={wp.source}
            options={SOURCES}
            onChange={wp.setSource}
          />
        }
      >
        {wp.source === "custom" ? (
          <div className="sky-wp-custom">
            <button type="button" className="sky-btn" onClick={() => void wp.addCustomFiles()}>
              <IconImage />
              Add images
            </button>
            <button type="button" className="sky-btn" onClick={() => void wp.addCustomFolder()}>
              <IconFolderOpen />
              Use a folder
            </button>
            <span className="sky-wp-custom__info" title={wp.customFolder ?? undefined}>
              {wp.hasCustom
                ? `${plural(wp.names.length, "image")}${wp.customFolder ? ` from ${wp.customFolder}` : ""}`
                : "No images yet"}
            </span>
            {wp.hasCustom ? (
              <ConfirmButton
                className="sky-textbtn sky-textbtn--danger"
                confirmLabel="Remove all your images?"
                title="Forget your images and go back to the built-in wallpapers (the files stay on your PC)"
                onConfirm={wp.clearCustom}
              >
                Remove all
              </ConfirmButton>
            ) : null}
          </div>
        ) : null}

        {empty ? (
          <p className="sky-wp-empty">
            {wp.source === "custom"
              ? "Add some images or pick a folder, and they appear here to choose from."
              : "No built-in wallpapers were found in this install."}
          </p>
        ) : (
          <ul className="sky-wp-grid" aria-label="Wallpapers">
            {wp.names.map((name) => (
              <WallpaperTile
                key={name}
                source={wp.source}
                name={name}
                mode={appearance}
                selected={name === wp.current}
                onSelect={wp.select}
              />
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard title="Rotation">
        <SettingRow label="Random order" description="Next and the automatic change pick any wallpaper, not the next in line.">
          {(ids) => <Switch checked={wp.random} onChange={wp.toggleRandom} {...ids} />}
        </SettingRow>
        <SettingRow
          label="Change automatically"
          description={
            wp.names.length > 1
              ? "The dashboard moves to a new wallpaper on a schedule, with a soft cross-fade."
              : "Needs at least two wallpapers to choose from."
          }
        >
          {(ids) => <Switch checked={wp.autoSwitch} onChange={wp.toggleAutoSwitch} {...ids} />}
        </SettingRow>
        <SettingRow label="Change every">
          {() => (
            <Segmented<WallpaperIntervalId>
              label="Change every"
              value={wp.intervalId}
              disabled={!wp.autoSwitch}
              options={WALLPAPER_INTERVALS.map((i) => ({ value: i.id, label: i.label }))}
              onChange={wp.setIntervalId}
            />
          )}
        </SettingRow>
      </SettingsCard>
    </>
  );
}
