import { useState } from "react";
import { useHistorySettings } from "../../../../history";
import { exportVault, importVault } from "../../../../vault";
import { useVaultData } from "../../../data/SkyData";
import { ConfirmButton } from "../../../ui/ConfirmButton";
import { plural } from "../../../ui/format";
import { SettingRow, SettingsCard, Switch } from "../components/SettingRow";

const RETENTION_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
  { days: 365, label: "1 year" },
  { days: 0, label: "Forever" },
];

/** What PilPod keeps on this PC, and how to back it up. */
export function DataPage() {
  const history = useHistorySettings();
  const { vault } = useVaultData();
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const s = history.settings;
  const retention =
    s && !RETENTION_OPTIONS.some((o) => o.days === s.retentionDays)
      ? [...RETENTION_OPTIONS, { days: s.retentionDays, label: `${s.retentionDays} days` }]
      : RETENTION_OPTIONS;

  return (
    <>
      <SettingsCard
        title="History"
        description="Pages you open and media that plays in connected browsers. Stored only on this PC, never sent anywhere."
      >
        {history.unavailable ? (
          <p className="sky-inline-error">The history database could not be opened this session. Restarting PilPod usually fixes it.</p>
        ) : s ? (
          <>
            <SettingRow label="Record history" description="Turning this off keeps what is already saved.">
              {(ids) => <Switch checked={s.recording} onChange={(v) => void history.update({ recording: v })} {...ids} />}
            </SettingRow>
            <SettingRow label="Keep history for" description="Older entries are removed automatically.">
              {({ labelId }) => (
                <select
                  className="sky-select"
                  aria-labelledby={labelId}
                  value={s.retentionDays}
                  onChange={(e) => void history.update({ retentionDays: Number(e.target.value) })}
                >
                  {retention.map((o) => (
                    <option key={o.days} value={o.days}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </SettingRow>
            <SettingRow label="Clear history" description="Removes every page and play. This cannot be undone.">
              {() => (
                <ConfirmButton
                  className="sky-btn sky-btn--danger"
                  confirmLabel="Clear everything?"
                  onConfirm={() => void history.clearAll()}
                >
                  Clear all history
                </ConfirmButton>
              )}
            </SettingRow>
          </>
        ) : (
          <p className="sky-setting__desc">Loading…</p>
        )}
      </SettingsCard>

      <SettingsCard
        title="Vault backup"
        description={`${plural(vault.bookmarks.length, "bookmark")}, ${plural(vault.playlists.length, "playlist")} and ${plural(vault.collections.length, "collection")}, saved as one file you can keep or move to another PC.`}
      >
        <SettingRow label="Export" description="Save the whole vault to a JSON file.">
          {() => (
            <button
              type="button"
              className="sky-btn"
              onClick={() =>
                void exportVault().then((ok) => setBackupNote(ok ? "Vault exported." : null))
              }
            >
              Export vault…
            </button>
          )}
        </SettingRow>
        <SettingRow
          label="Import"
          description="Load a vault file in place of everything saved now. Export first if you want to keep the current vault."
        >
          {() => (
            <ConfirmButton
              className="sky-btn"
              confirmLabel="Replace the current vault?"
              onConfirm={() =>
                void importVault().then((ok) => setBackupNote(ok ? "Vault imported." : null))
              }
            >
              Import vault…
            </ConfirmButton>
          )}
        </SettingRow>
        {backupNote ? (
          <p className="sky-settings-note" role="status">
            {backupNote}
          </p>
        ) : null}
      </SettingsCard>
    </>
  );
}
