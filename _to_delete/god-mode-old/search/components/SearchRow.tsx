import { memo } from "react";
import { IconOpenInTab, IconPause, IconPlay } from "../../../../shared/ui/icons";
import { Thumb } from "../../ui/Thumb";
import type { HitActions } from "../hooks/useHitActions";
import type { HitBadge, SearchHit } from "../lib/types";
import { Highlight } from "./Highlight";

const BADGE_LABEL: Record<HitBadge, string> = {
  playing: "Playing",
  paused: "Paused",
  audible: "Sound",
  pinned: "Pinned",
  "playlist-live": "Now playing",
};

/** What Enter does on this row, said on the row itself. */
function primaryLabel(hit: SearchHit): string {
  switch (hit.target.type) {
    case "tab":
      return "Show tab";
    case "playlist":
      return "Open";
    case "command":
      return "Run";
    default:
      return "Open";
  }
}

type Props = {
  hit: SearchHit;
  id: string;
  active: boolean;
  terms: readonly string[];
  actions: HitActions;
  onPick: (hit: SearchHit) => void;
  onHover: (key: string) => void;
};

function SearchRowView({ hit, id, active, terms, actions, onPick, onHover }: Props) {
  const secondary = actions.secondary(hit);
  const isCommand = hit.target.type === "command";
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      className={`gm-hit${active ? " gm-hit--active" : ""}${isCommand ? " gm-hit--command" : ""}`}
      // mousemove, not mouseenter: rows scrolled under a still pointer by the
      // arrow keys must not steal the keyboard selection.
      onMouseMove={active ? undefined : () => onHover(hit.key)}
      // Keep focus in the search box; the click still fires.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(hit)}
    >
      {isCommand ? (
        <span className="gm-hit__glyph" aria-hidden="true">
          {hit.glyph}
        </span>
      ) : (
        <Thumb
          src={hit.image}
          glyph={hit.glyph}
          hueKey={hit.subtitle || hit.title}
          kind={hit.imageKind}
          className="gm-hit__thumb"
        />
      )}
      <span className="gm-hit__text">
        <span className="gm-hit__title">
          <Highlight text={hit.title} terms={terms} />
        </span>
        {hit.subtitle ? (
          <span className="gm-hit__sub">
            <Highlight text={hit.subtitle} terms={terms} />
          </span>
        ) : null}
      </span>
      {hit.badge ? (
        <span className={`gm-hit__badge gm-hit__badge--${hit.badge}`}>
          {hit.badge === "playing" || hit.badge === "playlist-live" ? (
            <span className="gm-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : null}
          {BADGE_LABEL[hit.badge]}
        </span>
      ) : null}
      <span className="gm-hit__actions">
        {secondary.map((action) => (
          <button
            key={action.id}
            type="button"
            className="gm-icon-btn"
            title={action.label}
            aria-label={action.label}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              action.run();
            }}
          >
            {action.icon === "pause" ? <IconPause /> : action.icon === "play" ? <IconPlay /> : <IconOpenInTab />}
          </button>
        ))}
        {active ? (
          <span className="gm-hit__enter" aria-hidden="true">
            {primaryLabel(hit)} <kbd>↵</kbd>
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** Re-renders only when its hit, selection or terms change. */
export const SearchRow = memo(SearchRowView);
