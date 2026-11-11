import { useEffect, useRef } from "react";

/**
 * Run `onChange` when another PilPod window changes one of `keys`.
 *
 * Every PilPod window shares one origin, so a preference written to
 * localStorage in one window (say, the wallpaper picked in PilPod Sky) reaches
 * the others as a `storage` event. Hooks that keep a preference in state call
 * this to re-read it, which is what keeps the dashboard, Sky and any future
 * window showing the same settings without a restart.
 *
 * The event never fires in the window that wrote the value, and not at all
 * when the value did not change, so there is no echo loop. A `null` key means
 * storage was cleared, which counts as a change to every key.
 */
export function useStorageSync(keys: readonly string[], onChange: () => void): void {
  const handler = useRef(onChange);
  handler.current = onChange;
  const signature = keys.join("\n");

  useEffect(() => {
    const watched = new Set(signature.split("\n"));
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || watched.has(event.key)) handler.current();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [signature]);
}
