/**
 * Deterministic string → hue (FNV-1a), 0–359. Every tile for the same site
 * or name gets the same colour, in every section.
 */
export function hueFor(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}
