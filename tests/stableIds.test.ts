import { describe, expect, it } from "vitest";
import { makeEventKey, makePersonIdFromEmail, shortStableId } from "../src/ids/stableIds";

describe("stableIds", () => {
  it("makeEventKey склеивает calendarId и eventId через ':'", () => {
    expect(makeEventKey("cal", "event")).toBe("cal:event");
  });

  it("makePersonIdFromEmail нормализует mailto/регистр/пробелы", () => {
    const a = makePersonIdFromEmail("MAILTO:Test@Example.com");
    const b = makePersonIdFromEmail(" test@example.com ");
    expect(a).toBe(b);
    expect(a.startsWith("person-")).toBe(true);
    // person- + shortStableId(len=10)
    expect(a).toHaveLength("person-".length + 10);
  });

  it("makePersonIdFromEmail не падает на undefined/null (через any) и детерминированный", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = makePersonIdFromEmail(undefined as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = makePersonIdFromEmail(null as any);
    expect(a).toBe(makePersonIdFromEmail("")); // нормализация сводит к ""
    expect(a).toBe(b);
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
