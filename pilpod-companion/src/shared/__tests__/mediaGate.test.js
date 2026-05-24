import { describe, it, expect } from "vitest";
import { shouldReportMedia } from "../mediaGate.js";

const ALLOWLISTED = "https://www.youtube.com/watch?v=abc";
const NOT_ALLOWLISTED = "https://example.com/";

describe("shouldReportMedia", () => {
  const cases = [
    {
      label: "allowlisted URL (active, playing)",
      url: ALLOWLISTED,
      pass: true,
      reason: "url-allowlisted",
    },
    {
      label: "allowlisted URL regardless of tab state",
      url: ALLOWLISTED,
      pass: true,
      reason: "url-allowlisted",
    },
    {
      label: "url not allowlisted",
      url: NOT_ALLOWLISTED,
      pass: false,
      reason: "url-not-allowlisted",
    },
  ];

  it.each(cases)("$label", ({ url, pass, reason }) => {
    const result = shouldReportMedia({ url });
    expect(result.pass).toBe(pass);
    expect(result.reason).toBe(reason);
  });
});
