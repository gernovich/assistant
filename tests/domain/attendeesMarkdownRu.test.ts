import { describe, expect, it } from "vitest";
import { attendeesMarkdownBlockRu } from "../../src/domain/policies/attendeesMarkdownRu";

describe("domain/policies/attendeesMarkdownRu", () => {
  it("возвращает заглушку если массив пуст", () => {
    expect(attendeesMarkdownBlockRu([])).toBe("- (пока не удалось извлечь из календаря)");
  });

  it("рендерит строки и сортирует по email", () => {
    const s = attendeesMarkdownBlockRu([
      { email: "b@x.com", partstat: "DECLINED" },
      { email: "a@x.com", cn: "Alice", partstat: "ACCEPTED" },
    ]);
    expect(s).toBe("- Alice <a@x.com> — придёт\n- b@x.com — не придёт");
  });
});

