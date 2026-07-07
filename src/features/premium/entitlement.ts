import type { PremiumStatus } from "./types";

/**
 * Pure UI-side gate decision. Cosmetic only — the authoritative check is
 * `require_premium()` in Rust, which every premium command re-runs.
 */
export function isEntitled(
  status: PremiumStatus | null | undefined,
  feature: string,
): boolean {
  if (!status || !status.active) return false;
  return status.features.includes(feature);
}

/** Human-readable reason for the upsell panel. */
export function inactiveReasonLabel(status: PremiumStatus | null): string | null {
  if (!status?.reason) return null;
  if (status.reason === "expired") return "Your license has expired.";
  if (status.reason.startsWith("invalid_")) return "The stored license is invalid.";
  return null;
}
