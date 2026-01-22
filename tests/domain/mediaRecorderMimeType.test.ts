import { describe, expect, it } from "vitest";
import { pickMediaRecorderMimeType } from "../../src/domain/policies/mediaRecorderMimeType";

describe("domain/policies/mediaRecorderMimeType", () => {
  it("берёт первый поддерживаемый тип из prefs", () => {
    const picked = pickMediaRecorderMimeType({
      prefs: ["a", "b", "c"],
      isSupported: (t) => t === "b",
    });
    expect(picked).toBe("b");
  });

  it("возвращает пустую строку, если ничего не поддерживается", () => {
    const picked = pickMediaRecorderMimeType({
      prefs: ["a", "b"],
      isSupported: () => false,
    });
    expect(picked).toBe("");
  });
});

