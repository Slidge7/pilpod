import { playerErrorMessage, type PlayerStateDto } from "../../playlist-player";
import { WIDGET_CORNER_LABELS, type WidgetState } from "../../widget";
import type { OverviewStats } from "../types";

type Props = {
  player: PlayerStateDto;
  widget: WidgetState | null;
  stats: OverviewStats;
};

const PLAYER_STATUS: Record<PlayerStateDto["status"], string> = {
  idle: "Idle",
  opening: "Opening…",
  ready: "Playing",
  ended: "Ended",
  error: "Error",
};

function playerSummary(player: PlayerStateDto): {
  value: string;
  detail: string | null;
} {
  if (!player.active) return { value: "Idle", detail: null };
  const where = player.target === "inApp" ? "In-app window" : "Browser tab";
  const modes = [
    player.shuffle ? "shuffle" : null,
    player.repeat !== "off" ? `repeat ${player.repeat}` : null,
  ].filter(Boolean);
  return {
    value: `${PLAYER_STATUS[player.status]} · track ${player.trackNumber} of ${player.totalTracks}`,
    detail: [where, ...modes].join(" · "),
  };
}

function widgetSummary(widget: WidgetState | null): string {
  if (!widget) return "—";
  if (!widget.enabled) return "Off";
  return widget.placement.mode === "corner"
    ? `On · ${WIDGET_CORNER_LABELS[widget.placement.corner].toLowerCase()}`
    : "On · free";
}

/** What PilPod itself is running right now, beyond the browsers. */
export function RuntimePanel({ player, widget, stats }: Props) {
  const playback = playerSummary(player);
  return (
    <section className="gm-rail__section" aria-label="PilPod runtime">
      <h2 className="gm-rail__heading">PilPod</h2>
      <dl className="gm-runtime">
        <div className="gm-runtime__row">
          <dt>Browser bridge</dt>
          <dd>
            {stats.connected} of {stats.profiles} profile
            {stats.profiles === 1 ? "" : "s"} connected
          </dd>
        </div>
        <div className="gm-runtime__row">
          <dt>Playlist player</dt>
          <dd>
            <span className={player.active ? "gm-runtime__live" : undefined}>
              {playback.value}
            </span>
            {playback.detail ? <small>{playback.detail}</small> : null}
            {player.error ? (
              <small className="gm-runtime__error">
                {playerErrorMessage(player.error)}
              </small>
            ) : null}
          </dd>
        </div>
        <div className="gm-runtime__row">
          <dt>Floating widget</dt>
          <dd>{widgetSummary(widget)}</dd>
        </div>
      </dl>
    </section>
  );
}
