import { IDLE_INTERVALS, useIdleConfig } from "../../../../media-dashboard";
import type { IdleIntervalId } from "../../../../media-dashboard/idle";
import { Segmented } from "../../../ui/Segmented";
import { SettingRow, SettingsCard, Switch } from "../components/SettingRow";

/** When and how the dashboard fades back while you are away from it. */
export function IdlePage() {
  const idle = useIdleConfig();
  return (
    <SettingsCard
      title="Idle mode"
      description="When you stop using the dashboard, its browser cards fade so the wallpaper and what is playing take over. Moving the pointer lights up the cards under it; a click or a key press brings everything back."
    >
      <SettingRow label="Fade the dashboard when idle">
        {(ids) => <Switch checked={idle.enabled} onChange={idle.toggleEnabled} {...ids} />}
      </SettingRow>
      <SettingRow label="Fade after" description="How long the dashboard waits without a click or a key press.">
        {() => (
          <Segmented<IdleIntervalId>
            label="Fade after"
            value={idle.intervalId}
            disabled={!idle.enabled}
            options={IDLE_INTERVALS.map((i) => ({ value: i.id, label: i.label }))}
            onChange={idle.setIntervalId}
          />
        )}
      </SettingRow>
    </SettingsCard>
  );
}
