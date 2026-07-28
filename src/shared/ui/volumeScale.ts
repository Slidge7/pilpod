/**
 * The volume slider's scale, shared by every surface that shows one: the media
 * tab's cards and the in-app player window. Lives here rather than inside a
 * component so the two can never drift into behaving differently for the same
 * gesture.
 */

export const TAB_VOL_MAX = 600;

/** Number of discrete steps the native range input is divided into. */
export const VOL_TRACK_STEPS = 1000;

/**
 * Non-linear mapping (matches the companion UI): the first half of the slider
 * width covers 0–100%, the second half covers 100–`TAB_VOL_MAX`%. Boosting is
 * possible without making normal volumes impossible to set precisely.
 */
export function volumeToTrackFraction(v: number): number {
  const vol = Math.min(TAB_VOL_MAX, Math.max(0, v));
  if (vol <= 100) return (vol / 100) * 0.5;
  return 0.5 + ((vol - 100) / (TAB_VOL_MAX - 100)) * 0.5;
}

export function trackFractionToVolume(f: number): number {
  const t = Math.min(1, Math.max(0, f));
  const raw =
    t <= 0.5 ? (t / 0.5) * 100 : 100 + ((t - 0.5) / 0.5) * (TAB_VOL_MAX - 100);
  return Math.round(raw / 5) * 5;
}

/** Fill colour band, driving the `--muted` / `--boost` / `--high` modifiers. */
export function volFillTone(value: number): "muted" | "normal" | "boost" | "high" {
  if (value === 0) return "muted";
  if (value > 200) return "high";
  if (value > 100) return "boost";
  return "normal";
}
