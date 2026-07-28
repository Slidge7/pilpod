import { useEffect, useRef, useState } from "react";
import { IconChevronRight, IconTrash } from "../../../shared/ui/icons";
import type { Playlist } from "../../vault/types";

type Submenu = "move" | "copy" | null;

/**
 * Per-track menu: remove, or move/copy the track into another playlist.
 *
 * A popover rather than a nested dropdown so it stays usable in a 400px-wide
 * window: picking "Move to…" replaces the menu's contents with the playlist
 * list instead of opening a second layer beside it.
 */
export function PlayerTrackMenu({
  playlists,
  onRemove,
  onMove,
  onCopy,
}: {
  /** Every playlist except the one being viewed. */
  playlists: Playlist[];
  onRemove: () => void;
  onMove: (playlistId: string) => void;
  onCopy: (playlistId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setSubmenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setSubmenu(null);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (id: string) => {
    if (submenu === "move") onMove(id);
    else if (submenu === "copy") onCopy(id);
    setOpen(false);
    setSubmenu(null);
  };

  return (
    <div className="pilpod-pw-menu" ref={rootRef}>
      <button
        type="button"
        className="pilpod-pw-menu__trigger"
        title="Track options"
        aria-label="Track options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
          setSubmenu(null);
        }}
      >
        ⋯
      </button>

      {open ? (
        <div className="pilpod-pw-menu__pop" role="menu">
          {submenu === null ? (
            <>
              <button
                type="button"
                className="pilpod-pw-menu__item"
                role="menuitem"
                disabled={playlists.length === 0}
                onClick={() => setSubmenu("move")}
              >
                <span>Move to…</span>
                <IconChevronRight className="pilpod-icon--sm" />
              </button>
              <button
                type="button"
                className="pilpod-pw-menu__item"
                role="menuitem"
                disabled={playlists.length === 0}
                onClick={() => setSubmenu("copy")}
              >
                <span>Copy to…</span>
                <IconChevronRight className="pilpod-icon--sm" />
              </button>
              <div className="pilpod-pw-menu__sep" />
              <button
                type="button"
                className="pilpod-pw-menu__item pilpod-pw-menu__item--danger"
                role="menuitem"
                onClick={() => {
                  onRemove();
                  setOpen(false);
                }}
              >
                <IconTrash className="pilpod-icon--sm" />
                <span>Remove from playlist</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="pilpod-pw-menu__item pilpod-pw-menu__item--back"
                onClick={() => setSubmenu(null)}
              >
                <IconChevronRight className="pilpod-icon--sm pilpod-pw-menu__flip" />
                <span>{submenu === "move" ? "Move to" : "Copy to"}</span>
              </button>
              <div className="pilpod-pw-menu__sep" />
              <div className="pilpod-pw-menu__scroll">
                {playlists.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="pilpod-pw-menu__item"
                    role="menuitem"
                    onClick={() => pick(p.id)}
                  >
                    <span className="pilpod-pw-menu__emoji" aria-hidden>
                      {p.emoji || "♪"}
                    </span>
                    <span className="pilpod-pw-menu__name">{p.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
