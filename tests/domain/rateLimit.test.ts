import { describe, expect, it } from "vitest";
import { shouldEmitByInterval } from "../../src/domain/policies/rateLimit";

describe("domain/policies/rateLimit", () => {
  it("allows emit when enough time passed", () => {
    expect(shouldEmitByInterval({ nowMs: 100, lastAtMs: 0, intervalMs: 50 })).toBe(true);
    expect(shouldEmitByInterval({ nowMs: 49, lastAtMs: 0, intervalMs: 50 })).toBe(false);
  });
});
