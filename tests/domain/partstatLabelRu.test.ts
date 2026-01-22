import { describe, expect, it } from "vitest";
import { partstatLabelRu } from "../../src/domain/policies/partstatLabelRu";

describe("domain/policies/partstatLabelRu", () => {
  it("маппит основные статусы", () => {
    expect(partstatLabelRu("ACCEPTED")).toBe("придёт");
    expect(partstatLabelRu("DECLINED")).toBe("не придёт");
    expect(partstatLabelRu("TENTATIVE")).toBe("возможно");
    expect(partstatLabelRu("NEEDS-ACTION")).toBe("не указал");
  });

  it("нормализует регистр/пробелы и дефолтит в 'не указал'", () => {
    expect(partstatLabelRu(" accepted ")).toBe("придёт");
    expect(partstatLabelRu(undefined)).toBe("не указал");
    expect(partstatLabelRu("")).toBe("не указал");
  });
});

