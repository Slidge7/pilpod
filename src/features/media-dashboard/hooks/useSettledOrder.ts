import { useEffect, useRef, useState } from "react";

/**
 * Reorders `items` to a "settled" order so the list does not reshuffle while the
 * user is actively toggling media.
 *
 * The incoming `items` are assumed already sorted (e.g. playing-first). This hook
 * holds a frozen display order and only re-applies that sorted order after
 * `delayMs` of no change to the ordering signature. While the user keeps
 * play/pausing (which changes the signature), the timer restarts every time, so
 * the reorder only happens once they've been idle for `delayMs`.
 *
 * Membership still updates immediately: newly-appearing items are appended in
 * place (they don't jump to the top until the next settle) and disappearing
 * items drop out right away. The very first render adopts the sorted order with
 * no delay.
 */
export function useSettledOrder<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  delayMs: number,
): T[] {
  const orderRef = useRef<string[] | null>(null);
  const [, forceTick] = useState(0);

  const byKey = new Map(items.map((it) => [keyOf(it), it] as const));
  const desiredKeys = items.map(keyOf);

  // First run → adopt the sorted order immediately (no initial delay).
  if (orderRef.current == null) orderRef.current = desiredKeys;

  // Reconcile membership WITHOUT reordering: keep the frozen order for keys that
  // still exist, then append any brand-new keys at the end.
  const present = new Set(desiredKeys);
  const kept = orderRef.current.filter((k) => present.has(k));
  const keptSet = new Set(kept);
  const appended = desiredKeys.filter((k) => !keptSet.has(k));
  const displayedKeys = [...kept, ...appended];
  orderRef.current = displayedKeys;

  // Signature of the *desired* (sorted) order — changes on play/pause, new media,
  // or membership changes. Each change restarts the settle timer.
  const sig = desiredKeys.join("|");
  const desiredRef = useRef(desiredKeys);
  desiredRef.current = desiredKeys;

  useEffect(() => {
    const id = setTimeout(() => {
      orderRef.current = desiredRef.current;
      forceTick((n) => n + 1);
    }, delayMs);
    return () => clearTimeout(id);
  }, [sig, delayMs]);

  return displayedKeys
    .map((k) => byKey.get(k))
    .filter((v): v is T => v !== undefined);
}
