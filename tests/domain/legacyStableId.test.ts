import { describe, expect, it } from "vitest";
import { extractLegacyStableIdFromPath, legacyStableIdSuffix } from "../../src/domain/policies/legacyStableId";

describe("domain/policies/legacyStableId", () => {
  it("extractLegacyStableIdFromPath: извлекает sid из суффикса ' [xxxxxx].md'", () => {
    expect(extractLegacyStableIdFromPath("Ассистент/Встречи/Meeting [abcdef].md")).toBe("abcdef");
    expect(extractLegacyStableIdFromPath("x [ABCDEF].md")).toBe("abcdef");
  });

  it("extractLegacyStableIdFromPath: возвращает null если не совпало", () => {
    expect(extractLegacyStableIdFromPath("x.md")).toBeNull();
    expect(extractLegacyStableIdFromPath("x [abcde].md")).toBeNull(); // 5 символов
    expect(extractLegacyStableIdFromPath("x [abcdeg].md")).toBeNull(); // g не hex (совместимость с текущим regex)
  });

  it("legacyStableIdSuffix: формирует ожидаемый суффикс", () => {
    expect(legacyStableIdSuffix("abcdef")).toBe(" [abcdef].md");
  });
});

