import { describe, expect, it } from "vitest";
import { trimForLogPolicy } from "../../src/domain/policies/logText";

describe("domain/policies/logText", () => {
  it("does not truncate when within limit", () => {
    expect(trimForLogPolicy("abc", 3)).toBe("abc");
  });

  it("truncates and adds suffix", () => {
    expect(trimForLogPolicy("abcd", 3)).toBe("abc…(truncated)");
  });
});

