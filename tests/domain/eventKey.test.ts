import { describe, expect, it } from "vitest";
import { makeEventKey, parseEventKey } from "../../src/domain/identity/eventKey";

describe("domain/identity/eventKey", () => {
  it("makeEventKey формирует calendarId:eventId", () => {
    expect(String(makeEventKey("cal", "uid"))).toBe("cal:uid");
  });

  it("makeEventKey не бросает исключения и возвращает стабильную строку", () => {
    expect(String(makeEventKey("", "x"))).toBe(":x");
    expect(String(makeEventKey("c", ""))).toBe("c:");
  });

  it("parseEventKey принимает строку с ':' и непустыми частями", () => {
    expect(parseEventKey("a:b")).toBeTruthy();
    expect(parseEventKey("a:")).toBeNull();
    expect(parseEventKey(":b")).toBeNull();
    expect(parseEventKey("ab")).toBeNull();
  });
});
