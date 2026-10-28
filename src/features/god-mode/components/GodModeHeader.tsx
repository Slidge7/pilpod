import { useEffect, useRef } from "react";
import {
  IconClose,
  IconGodMode,
  IconMaximize,
  IconMinimize,
  IconRefresh,
  IconSearch,
  IconX,
} from "../../../shared/ui/icons";
import { useWindowChrome } from "../hooks/useWindowChrome";

type Props = {
  search: string;
  onSearch: (value: string) => void;
  onSync: () => void;
};

/**
 * Title bar: brand, search, sync, and the window buttons (the window is
 * undecorated). Empty space drags the window; double-click maximizes.
 */
export function GodModeHeader({ search, onSearch, onSync }: Props) {
  const chrome = useWindowChrome();
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/⌘+F or "/" jumps to search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      const find = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f";
      if (find || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="gm-header" data-tauri-drag-region>
      <div className="gm-brand" data-tauri-drag-region>
        <span className="gm-brand__mark" aria-hidden="true">
          <IconGodMode />
        </span>
        <h1 className="gm-brand__title" data-tauri-drag-region>
          God Mode
        </h1>
        <span
          className="gm-live"
          title="Updates live from every connected browser"
        >
          <span className="gm-live__dot" aria-hidden="true" />
          Live
        </span>
      </div>

      <label className="gm-search">
        <IconSearch className="gm-search__icon" />
        <span className="gm-visually-hidden">Search tabs</span>
        <input
          ref={inputRef}
          type="search"
          value={search}
          placeholder="Search every tab — title, site, artist…"
          spellCheck={false}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onSearch("");
              e.currentTarget.blur();
            }
          }}
        />
        {search ? (
          <button
            type="button"
            className="gm-search__clear"
            onClick={() => {
              onSearch("");
              inputRef.current?.focus();
            }}
            title="Clear search"
            aria-label="Clear search"
          >
            <IconX />
          </button>
        ) : (
          <kbd className="gm-search__hint" aria-hidden="true">
            Ctrl F
          </kbd>
        )}
      </label>

      <div className="gm-header__actions">
        <button
          type="button"
          className="gm-btn"
          onClick={onSync}
          title="Ask every connected browser to resend its tabs"
        >
          <IconRefresh />
          Sync
        </button>
        <span className="gm-header__sep" aria-hidden="true" />
        <button
          type="button"
          className="gm-window-btn"
          onClick={chrome.minimize}
          title="Minimize"
          aria-label="Minimize"
        >
          <IconMinimize />
        </button>
        <button
          type="button"
          className="gm-window-btn"
          onClick={chrome.toggleMaximize}
          title="Maximize"
          aria-label="Maximize"
        >
          <IconMaximize />
        </button>
        <button
          type="button"
          className="gm-window-btn gm-window-btn--close"
          onClick={chrome.close}
          title="Close"
          aria-label="Close"
        >
          <IconClose />
        </button>
      </div>
    </header>
  );
}
