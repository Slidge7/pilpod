/** Mirror of Rust `premium::PremiumStatus` (serde camelCase). */
export interface PremiumStatus {
  active: boolean;
  plan: string;
  features: string[];
  email: string | null;
  expiresAt: number | null;
  reason: string | null;
}

export const PREMIUM_STATUS_EVENT = "premium://status";
export const ERR_PREMIUM_REQUIRED = "premium_required";
