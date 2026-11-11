import { memo } from "react";
import {
  IconBookmark,
  IconBookmarkFilled,
  IconOpenInTab,
  IconPause,
  IconPlay,
} from "../../../../shared/ui/icons";

const ACTION_ICON = {
  play: IconPlay,
  pause: IconPause,
  reveal: IconOpenInTab,
  bookmark: IconBookmark,
  bookmarked: IconBookmarkFilled,
} as const;
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
      className={`sky-hit${active ? " sky-hit--active" : ""}${isCommand ? " sky-hit--command" : ""}`}
      // mousemove, not mouseenter: rows scrolled under a still pointer by the
      // arrow keys must not steal the keyboard selection.
      onMouseMove={active ? undefined : () => onHover(hit.key)}
      // Keep focus in the search box; the click still fires.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(hit)}
    >
      {isCommand ? (
        <span className="sky-hit__glyph" aria-hidden="true">
          {hit.glyph}
        </span>
      ) : (
        <Thumb
          src={hit.image}
          glyph={hit.glyph}
          hueKey={hit.subtitle || hit.title}
          kind={hit.imageKind}
          className="sky-hit__thumb"
        />
      )}
      <span className="sky-hit__text">
        <span className="sky-hit__title">
          <Highlight text={hit.title} terms={terms} />
        </span>
        {hit.subtitle ? (
          <span className="sky-hit__sub">
            <Highlight text={hit.subtitle} terms={terms} />
          </span>
        ) : null}
      </span>
      {hit.badge ? (
        <span className={`sky-hit__badge sky-hit__badge--${hit.badge}`}>
          {hit.badge === "playing" || hit.badge === "playlist-live" ? (
            <span className="sky-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : null}
          {BADGE_LABEL[hit.badge]}
        </span>
      ) : null}
      <span className="sky-hit__actions">
        {secondary.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`sky-icon-btn${action.icon === "bookmarked" ? " sky-icon-btn--saved" : ""}`}
            title={action.label}
            aria-label={action.label}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              action.run();
            }}
          >
            {(() => {
              const Icon = ACTION_ICON[action.icon];
              return <Icon />;
            })()}
          </button>
        ))}
        {active ? (
          <span className="sky-hit__enter" aria-hidden="true">
            {primaryLabel(hit)} <kbd>↵</kbd>
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** Re-renders only when its hit, selection or terms change. */
export const SearchRow = memo(SearchRowView);
