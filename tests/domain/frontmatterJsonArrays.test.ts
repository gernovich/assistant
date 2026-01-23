import { describe, expect, it } from "vitest";
import { parseJsonStringArray } from "../../src/domain/policies/frontmatterJsonArrays";

describe("domain/policies/frontmatterJsonArrays", () => {
  it("parses json string array", () => {
    expect(parseJsonStringArray('["a","b"]')).toEqual(["a", "b"]);
  });

  it("returns [] for invalid json", () => {
    expect(parseJsonStringArray("[")).toEqual([]);
  });
});
