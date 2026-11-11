import { useCallback, useState } from "react";

const STORAGE_KEY = "pilpod-sky-recent-searches";
const MAX_RECENT = 6;

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: recents just do not persist */
  }
}

/** Searches the user acted on, newest first. Kept on this PC only. */
export function useRecentSearches() {
  const [recent, setRecent] = useState<string[]>(read);

  const remember = useCallback((text: string) => {
    const value = text.trim();
    if (value.length < 2) return;
    setRecent((list) => {
      const next = [value, ...list.filter((v) => v.toLowerCase() !== value.toLowerCase())].slice(
        0,
        MAX_RECENT,
      );
      write(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    write([]);
    setRecent([]);
  }, []);

  return { recent, remember, clear };
}
