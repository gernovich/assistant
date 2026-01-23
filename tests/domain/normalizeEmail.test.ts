import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../../src/domain/policies/normalizeEmail";

describe("domain/policies/normalizeEmail", () => {
  it("trim + lower-case", () => {
    expect(normalizeEmail("  USER@EXAMPLE.COM  ")).toBe("user@example.com");
  });

  it("поддерживает mailto:", () => {
    expect(normalizeEmail("mailto:User@Example.com")).toBe("user@example.com");
  });
});
