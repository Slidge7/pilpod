import { describe, expect, it } from "vitest";
import { inactiveReasonLabel, isEntitled } from "./entitlement";
import type { PremiumStatus } from "./types";

const premium = (overrides: Partial<PremiumStatus> = {}): PremiumStatus => ({
  active: true,
  plan: "premium",
  features: ["downloader"],
  email: "t@e.com",
  expiresAt: null,
  reason: null,
  ...overrides,
});

describe("isEntitled", () => {
  it("passes for an active license containing the feature", () => {
    expect(isEntitled(premium(), "downloader")).toBe(true);
  });

  it("blocks null / undefined status (loading or stub build)", () => {
    expect(isEntitled(null, "downloader")).toBe(false);
    expect(isEntitled(undefined, "downloader")).toBe(false);
  });

  it("blocks inactive status even if features are listed", () => {
    expect(isEntitled(premium({ active: false }), "downloader")).toBe(false);
  });

  it("blocks a feature not in the license", () => {
    expect(isEntitled(premium({ features: ["other"] }), "downloader")).toBe(false);
  });
});

describe("inactiveReasonLabel", () => {
  it("maps expired and invalid reasons, hides internals otherwise", () => {
    expect(inactiveReasonLabel(premium({ reason: "expired" }))).toMatch(/expired/i);
    expect(inactiveReasonLabel(premium({ reason: "invalid_signature" }))).toMatch(/invalid/i);
    expect(inactiveReasonLabel(premium({ reason: null }))).toBeNull();
    expect(inactiveReasonLabel(null)).toBeNull();
  });
});
