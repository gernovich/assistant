import { describe, expect, it } from "vitest";
import { parseFrontmatterDate } from "../../src/domain/policies/frontmatterDate";

describe("parseFrontmatterDate", () => {
  it("returns Date as-is", () => {
    const d = new Date("2026-01-01T00:00:00.000Z");
    expect(parseFrontmatterDate(d)?.toISOString()).toBe(d.toISOString());
  });

  it("parses ISO string", () => {
    expect(parseFrontmatterDate("2026-01-01T00:00:00.000Z")?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns undefined for invalid", () => {
    expect(parseFrontmatterDate("nope")).toBeUndefined();
    expect(parseFrontmatterDate(123)).toBeUndefined();
    expect(parseFrontmatterDate(undefined)).toBeUndefined();
  });
});

