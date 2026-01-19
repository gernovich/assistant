import { describe, expect, it } from "vitest";
import { makeEventKey, shortStableId } from "../src/ids/stableIds";

describe("stableIds", () => {
  it("makeEventKey склеивает calendarId и uid через ':'", () => {
    expect(makeEventKey("cal", "uid")).toBe("cal:uid");
  });

  it("shortStableId детерминированный и нужной длины", () => {
    const a = shortStableId("hello", 6);
    const b = shortStableId("hello", 6);
    expect(a).toBe(b);
    expect(a).toHaveLength(6);
  });

  it("shortStableId меняется при изменении input", () => {
    expect(shortStableId("a", 6)).not.toBe(shortStableId("b", 6));
  });

  it("shortStableId поддерживает другую длину", () => {
    expect(shortStableId("hello", 8)).toHaveLength(8);
  });
});
