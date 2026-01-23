import { describe, expect, it } from "vitest";
import { attendeesTooltipRu, countAttendeesPartstat } from "../../src/domain/policies/attendeesSummaryRu";

describe("domain/policies/attendeesSummaryRu", () => {
  it("countAttendeesPartstat считает статусы, неизвестное -> unknown", () => {
    const c = countAttendeesPartstat([
      { partstat: "ACCEPTED" },
      { partstat: "DECLINED" },
      { partstat: "TENTATIVE" },
      { partstat: "NEEDS-ACTION" },
      { partstat: "" },
    ]);
    expect(c).toEqual({ accepted: 1, declined: 1, tentative: 1, unknown: 2 });
  });

  it("attendeesTooltipRu возвращает '' для пустого списка", () => {
    expect(attendeesTooltipRu([])).toBe("");
  });

  it("attendeesTooltipRu формирует строку в совместимом формате", () => {
    const s = attendeesTooltipRu([{ partstat: "ACCEPTED" }, { partstat: "ACCEPTED" }, { partstat: "DECLINED" }]);
    expect(s).toBe("Принято: 2; Отклонено: 1;");
  });
});
