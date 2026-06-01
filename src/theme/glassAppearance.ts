const GLASS_STRENGTH_STORAGE_KEY = "pilpod-glass-strength";
const DEFAULT_STRENGTH = 100;
const MIN = 0;
const MAX = 100;

export function readStoredGlassStrength(): number {
  try {
    const raw = localStorage.getItem(GLASS_STRENGTH_STORAGE_KEY);
    if (raw == null) return DEFAULT_STRENGTH;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_STRENGTH;
    return Math.min(MAX, Math.max(MIN, Math.round(n)));
  } catch {
    return DEFAULT_STRENGTH;
  }
}

export function persistGlassStrength(value: number) {
  try {
    localStorage.setItem(GLASS_STRENGTH_STORAGE_KEY, String(value));
  } catch {
    /* ignore */
  }
}

/** 0 = opaque / readable, 100 = full glass (blur + transparency). */
export function applyGlassStrength(percent: number) {
  const clamped = Math.min(MAX, Math.max(MIN, Math.round(percent)));
  const strength = clamped / 100;
  const root = document.documentElement;
  root.style.setProperty("--pilpod-glass-strength", String(strength));
  root.style.setProperty("--pilpod-glass-blur-float", `${4 * strength}px`);
  root.style.setProperty("--pilpod-glass-blur-card", `${8 * strength}px`);
  root.style.setProperty("--pilpod-glass-blur-panel", `${12 * strength}px`);
}

export { GLASS_STRENGTH_STORAGE_KEY, DEFAULT_STRENGTH, MIN as GLASS_STRENGTH_MIN, MAX as GLASS_STRENGTH_MAX };
