import { describe, expect, it } from "vitest";
import { parseMomentaryLufsFromEbur128Line } from "../../src/domain/policies/ebur128";

describe("domain/policies/ebur128", () => {
  it("parses momentary LUFS from M:", () => {
    expect(parseMomentaryLufsFromEbur128Line("t: 3.28  M: -28.3 S: ...")).toBe(-28.3);
  });

  it("returns null when no match", () => {
    expect(parseMomentaryLufsFromEbur128Line("nope")).toBeNull();
  });
});

