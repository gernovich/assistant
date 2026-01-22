import { describe, expect, it } from "vitest";
import { makeEventKey, parseEventKey } from "../../src/domain/identity/eventKey";

describe("domain/identity/eventKey", () => {
  it("makeEventKey формирует calendarId:eventId", () => {
    expect(String(makeEventKey("cal", "uid"))).toBe("cal:uid");
  });

  it("makeEventKey валидирует непустые части", () => {
    expect(() => makeEventKey("", "x")).toThrow();
    expect(() => makeEventKey("c", "")).toThrow();
  });

  it("parseEventKey принимает строку с ':' и непустыми частями", () => {
    expect(parseEventKey("a:b")).toBeTruthy();
    expect(parseEventKey("a:")).toBeNull();
    expect(parseEventKey(":b")).toBeNull();
    expect(parseEventKey("ab")).toBeNull();
  });
});

