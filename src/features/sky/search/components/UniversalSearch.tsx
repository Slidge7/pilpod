import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import "../Search.css";
import { IconSearch, IconX } from "../../../../shared/ui/icons";
import { useRecentSearches } from "../hooks/useRecentSearches";
import type { SearchScope } from "../lib/query";
import { SearchPanel, type SearchPanelHandle } from "./SearchPanel";

/**
 * Sky's search: one box for everything PilPod knows — open tabs in every
 * browser, bookmarks, playlists and their tracks, history, and actions.
 *
 * Ctrl+K, Ctrl+F or "/" focus it from anywhere. The box is an ARIA combobox;
 * the results panel is its listbox.
 *
 * Memoized: it takes no props, so the header re-rendering on every browser
 * tick never reaches it. While open, its panel subscribes to what it needs.
 */
export const UniversalSearch = memo(function UniversalSearch() {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<SearchScope>("all");
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const recents = useRecentSearches();

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<SearchPanelHandle>(null);
  const listboxId = useId();

  const focusSearch = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    setOpen(true);
  }, []);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if ((mod && (key === "k" || key === "f")) || (e.key === "/" && !typing)) {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const done = useCallback(() => {
    setOpen(false);
    inputRef.current?.blur();
  }, []);

  const setInput = useCallback((next: string) => {
    setValue(next);
    setOpen(true);
    inputRef.current?.focus();
  }, []);

  return (
    <div className={`sky-search${open ? " sky-search--open" : ""}`} ref={rootRef}>
      <label className="sky-search__field">
        <IconSearch className="sky-search__icon" />
        <span className="sky-visually-hidden">Search everything</span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? activeId : undefined}
          aria-autocomplete="list"
          value={value}
          placeholder="Search tabs, bookmarks, playlists, history…"
          spellCheck={false}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              if (open) setOpen(false);
              else if (value) setValue("");
              else e.currentTarget.blur();
              return;
            }
            if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
              setOpen(true);
              e.preventDefault();
              return;
            }
            if (open && panelRef.current?.handleKey(e)) e.preventDefault();
          }}
        />
        {value ? (
          <button
            type="button"
            className="sky-search__clear"
            onClick={() => setInput("")}
            title="Clear search"
            aria-label="Clear search"
          >
            <IconX />
          </button>
        ) : (
          <kbd className="sky-search__hint" aria-hidden="true">
            Ctrl K
          </kbd>
        )}
      </label>

      {open ? (
        <SearchPanel
          ref={panelRef}
          listboxId={listboxId}
          value={value}
          scope={scope}
          onScope={setScope}
          onInput={setInput}
          onDone={done}
          onActiveId={setActiveId}
          recent={recents.recent}
          onRemember={recents.remember}
          onClearRecent={recents.clear}
        />
      ) : null}
    </div>
  );
});
