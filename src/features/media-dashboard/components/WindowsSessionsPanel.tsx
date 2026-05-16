import type { MediaSessionDto } from "../../../types/media";
import { winRowKey } from "../lib/windowsMedia";
import { WindowsSessionRow } from "./WindowsSessionRow";

type Props = {
  sessions: MediaSessionDto[];
  pendingKeys: ReadonlySet<string>;
  onToggleSession: (s: MediaSessionDto) => void;
};

export function WindowsSessionsPanel({
  sessions,
  pendingKeys,
  onToggleSession,
}: Props) {
  return (
    <section role="tabpanel" id="panel-windows" aria-labelledby="tab-windows">
      {sessions.length === 0 ? (
        <p className="py-8 text-center text-[11px] leading-snug text-zinc-500">
          No Windows media sessions.
        </p>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-sm border border-zinc-300 bg-white divide-y divide-zinc-200 p-0 dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-950/50">
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
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
