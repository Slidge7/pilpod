import { describe, expect, it } from "vitest";
import { formatTags, parseTags } from "../tags";

describe("tags", () => {
  it("splits on commas and spaces, drops # and duplicates", () => {
    expect(parseTags("react, docs  #css React ,, ")).toEqual(["react", "docs", "css"]);
    expect(parseTags("")).toEqual([]);
  });

  it("round-trips through the field", () => {
    expect(parseTags(formatTags(["a", "b"]))).toEqual(["a", "b"]);
  });
});
