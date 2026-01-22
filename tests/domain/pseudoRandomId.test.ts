import { describe, expect, it } from "vitest";
import { makePseudoRandomId } from "../../src/domain/policies/pseudoRandomId";

describe("domain/policies/pseudoRandomId", () => {
  it("детерминированно формирует id", () => {
    expect(makePseudoRandomId({ prefix: "p", nowMs: 1000, randomHex: "abc" })).toBe("p-rs-abc");
  });
});

