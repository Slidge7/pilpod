import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconPlay, IconShuffle, Spinner } from "../../../../../shared/ui/icons";
import type { PlayTarget } from "../usePlaylistActions";

export type TargetOption = { value: PlayTarget; label: string };

type Props = {
  disabled: boolean;
  busy: boolean;
  target: PlayTarget;
  options: readonly TargetOption[];
  onTarget: (target: PlayTarget) => void;
  onPlay: (shuffle: boolean) => void;
};

/**
 * Play, with where it plays one click away: PilPod's own player by default,
 * or any connected browser.
 */
export function PlayButton({ disabled, busy, target, options, onTarget, onPlay }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === target) ?? options[0];
  const where = current.label.replace(/^In /, "in ");

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="gm-play" ref={rootRef}>
      <div className="gm-play__split">
        <button type="button" className="gm-play__main" disabled={disabled || busy} onClick={() => onPlay(false)}>
          {busy ? <Spinner /> : <IconPlay />}
          Play
        </button>
        <button
          type="button"
          className="gm-play__caret"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          aria-label={`Plays ${where}. Change where`}
          title="Where to play"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <IconChevronDown />
        </button>
      </div>
      <button type="button" className="gm-btn" disabled={disabled || busy} onClick={() => onPlay(true)}>
        <IconShuffle />
        Shuffle
      </button>
      <span className="gm-play__where">Plays {where}</span>
      {menuOpen ? (
        <ul className="gm-menu" role="listbox" aria-label="Where to play">
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === target}>
              <button
                type="button"
                onClick={() => {
                  onTarget(o.value);
                  setMenuOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
