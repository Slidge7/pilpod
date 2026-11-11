import { playerErrorMessage, type PlayerStateDto } from "../../playlist-player";
import { WIDGET_CORNER_LABELS, type WidgetState } from "../../widget";
import { useLiveBrowsers, usePlayer, useWidget } from "../data/GodModeData";

const PLAYER_STATUS: Record<PlayerStateDto["status"], string> = {
  idle: "Idle",
  opening: "Opening…",
  ready: "Playing",
  ended: "Ended",
  error: "Error",
};

function playerSummary(player: PlayerStateDto): string {
  if (!player.active) return "Idle";
  const where = player.target === "inApp" ? "in PilPod" : "in a browser tab";
  return `${PLAYER_STATUS[player.status]} ${where} · ${player.trackNumber}/${player.totalTracks}`;
}

function widgetSummary(widget: WidgetState | null): string {
  if (!widget) return "—";
  if (!widget.enabled) return "Off";
  return widget.placement.mode === "corner"
    ? `On, ${WIDGET_CORNER_LABELS[widget.placement.corner].toLowerCase()}`
    : "On, free";
}

/** What PilPod itself is running, beyond the browsers. Pinned to the sidebar's foot. */
export function StatusPanel() {
  const { stats } = useLiveBrowsers();
  const { player } = usePlayer();
  const widget = useWidget();
  const bridgeOk = stats.profiles > 0 && stats.connected === stats.profiles;

  return (
    <section className="gm-status-panel" aria-label="PilPod status">
      <dl>
        <div className="gm-status-panel__row">
          <dt>
            <span
              className={`gm-dot ${stats.connected === 0 ? "gm-dot--off" : bridgeOk ? "gm-dot--ok" : "gm-dot--warn"}`}
              aria-hidden="true"
            />
            Browser bridge
          </dt>
          <dd>
            {stats.connected}/{stats.profiles} connected
          </dd>
        </div>
        <div className="gm-status-panel__row">
          <dt>
            <span
              className={`gm-dot ${player.active ? "gm-dot--live" : "gm-dot--off"}`}
              aria-hidden="true"
            />
            Playlist player
          </dt>
          <dd title={player.error ? playerErrorMessage(player.error) : undefined}>
            {playerSummary(player)}
          </dd>
        </div>
        <div className="gm-status-panel__row">
          <dt>
            <span
              className={`gm-dot ${widget?.enabled ? "gm-dot--ok" : "gm-dot--off"}`}
              aria-hidden="true"
            />
            Floating widget
          </dt>
          <dd>{widgetSummary(widget)}</dd>
        </div>
      </dl>
    </section>
  );
}
