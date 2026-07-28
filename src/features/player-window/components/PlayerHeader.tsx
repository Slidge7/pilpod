import { invoke } from "@tauri-apps/api/core";
import {
  IconMinimize,
  IconMusicNote,
  IconWidgetClose,
} from "../../../shared/ui/icons";

/**
 * The window's title bar. The window has no OS decorations, so dragging and
 * minimising go through plain app commands (`inapp_drag_window` /
 * `inapp_minimize_window`) rather than `data-tauri-drag-region`: app commands
 * need no capability, so the bar works in the player webview no matter how its
 * permissions resolve.
 */
export function PlayerHeader({
  title,
  trackNumber,
  totalTracks,
  onClose,
}: {
  title: string;
  trackNumber: number;
  totalTracks: number;
  onClose: () => void;
}) {
  return (
    <header
      className="pilpod-pw-head"
      onPointerDown={(e) => {
        // Ignore drags that start on a button.
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest("button")) return;
        void invoke("inapp_drag_window").catch(() => {});
      }}
    >
      <span className="pilpod-pw-head__grip" aria-hidden />

      <IconMusicNote className="pilpod-icon--sm pilpod-pw-head__note" />
      <span className="pilpod-pw-head__title" title={title}>
        {title}
      </span>
      {totalTracks > 0 ? (
        <span className="pilpod-pw-head__counter">
          {trackNumber}/{totalTracks}
        </span>
      ) : null}

      <button
        type="button"
        className="pilpod-pw-head__btn"
        title="Minimize"
        aria-label="Minimize"
        onClick={() => void invoke("inapp_minimize_window").catch(() => {})}
      >
        <IconMinimize className="pilpod-icon--sm" />
      </button>
      <button
        type="button"
        className="pilpod-pw-head__btn pilpod-pw-head__btn--close"
        title="Close the player"
        aria-label="Close the player"
        onClick={onClose}
      >
        <IconWidgetClose className="pilpod-icon--sm" />
      </button>
    </header>
  );
}
