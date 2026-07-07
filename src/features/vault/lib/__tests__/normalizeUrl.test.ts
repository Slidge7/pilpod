import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../normalizeUrl";
import vectors from "./urlVectors.json";

/**
 * Parity with the Rust implementation. `urlVectors.json` is a copy of the Rust
 * `src-tauri/src/vault/testdata/url_vectors.json`; both sides must agree.
 */
describe("normalizeUrl (Rust parity)", () => {
  for (const { input, expected } of vectors as Array<{ input: string; expected: string }>) {
    it(`normalizes ${JSON.stringify(input)}`, () => {
      expect(normalizeUrl(input)).toBe(expected);
    });
  }

  it("is idempotent for every vector", () => {
    for (const { input } of vectors as Array<{ input: string }>) {
      const once = normalizeUrl(input);
      expect(normalizeUrl(once)).toBe(once);
    }
  });

  it("is order-independent for query params", () => {
    expect(normalizeUrl("https://x.com/a?b=2&a=1&c=3")).toBe(
      normalizeUrl("https://x.com/a?c=3&a=1&b=2"),
    );
  });
});
