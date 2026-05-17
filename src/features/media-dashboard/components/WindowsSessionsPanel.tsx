import "./WindowsSessionsPanel.css";
import type { MediaSessionDto } from "../../../types/media";
import { winRowKey } from "../lib/windowsMedia";
import { WindowsSessionRow } from "./WindowsSessionRow";

type Props = {
  sessions: MediaSessionDto[];
  pendingKeys: ReadonlySet<string>;
  onToggleSession: (s: MediaSessionDto) => void;
  onMixerVolume: (instanceId: string, volume: number) => void;
};

export function WindowsSessionsPanel({
  sessions,
  pendingKeys,
  onToggleSession,
  onMixerVolume,
}: Props) {
  return (
    <section role="tabpanel" id="panel-windows" aria-labelledby="tab-windows">
      {sessions.length === 0 ? (
        <p className="pilpod-windows-panel__empty">
          No Windows media sessions.
        </p>
      ) : (
        <ul className="pilpod-windows-panel__list">
          {sessions.map((s) => {
            const rk = winRowKey(s);
            const busy = pendingKeys.has(rk);
            const disabled = busy || !s.controls.playPauseToggleEnabled;

            return (
              <WindowsSessionRow
                key={rk}
                session={s}
                busy={busy}
                disabled={disabled}
                onPlayPause={onToggleSession}
                onMixerVolume={onMixerVolume}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
