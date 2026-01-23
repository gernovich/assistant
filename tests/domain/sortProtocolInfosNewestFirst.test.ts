import { describe, expect, it } from "vitest";
import { sortProtocolInfosNewestFirst } from "../../src/domain/policies/sortProtocolInfosNewestFirst";

describe("sortProtocolInfosNewestFirst", () => {
  it("sorts by start desc and moves missing start to the end", () => {
    const a = { id: "a", start: new Date("2026-01-01T10:00:00.000Z") };
    const b = { id: "b", start: new Date("2026-01-01T12:00:00.000Z") };
    const c = { id: "c" as const };

    const out = sortProtocolInfosNewestFirst([a, c as any, b]);
    expect(out.map((x: any) => x.id)).toEqual(["b", "a", "c"]);
  });
});
