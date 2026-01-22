import { describe, expect, it, vi } from "vitest";
import { createUniqueMarkdownFile, isTFile as isTFileFromFileNaming } from "../src/vault/fileNaming";
import { sanitizeFileName } from "../src/domain/policies/sanitizeFileName";
import { ensureFile, isTFile } from "../src/vault/ensureFile";
import { yamlEscape } from "../src/domain/policies/yamlEscape";

class FakeVault {
  private files = new Map<string, { path: string; extension?: string; content: string }>();

  getAbstractFileByPath(path: string) {
    return this.files.get(path);
  }

  async create(path: string, content: string) {
    const ext = path.split(".").pop() ?? "";
    const f = { path, extension: ext, content };
    this.files.set(path, f);
    return f;
  }
}

describe("vault utils", () => {
  it("sanitizeFileName убирает запрещённые символы и нормализует пробелы", () => {
    expect(sanitizeFileName(' A/B\\\\C:*?"<>|  ')).toBe("A B C");
  });

  it("sanitizeFileName возвращает 'Без названия' для пустой строки", () => {
    expect(sanitizeFileName("")).toBe("Без названия");
    expect(sanitizeFileName("   ")).toBe("Без названия");
  });

  it("yamlEscape возвращает JSON-строку и убирает переносы строк", () => {
    expect(yamlEscape("a\nb")).toBe('"a b"');
    expect(yamlEscape("a\r\nb")).toBe('"a b"');
    // Ветка `(v ?? "")`
    expect(yamlEscape(undefined as any)).toBe('""');
  });

  it("ensureFile создаёт файл если его нет, иначе возвращает существующий", async () => {
    const v = new FakeVault();
    const f1 = await ensureFile(v as any, "x.md", "hello");
    const f2 = await ensureFile(v as any, "x.md", "ignored");
    expect(f1.path).toBe("x.md");
    expect(f2.path).toBe("x.md");
  });

  it("isTFile распознаёт объект с extension", () => {
    expect(isTFile({ extension: "md" } as any)).toBe(true);
    expect(isTFile({} as any)).toBe(false);
  });

  it("fileNaming.isTFile распознаёт объект с extension", () => {
    expect(isTFileFromFileNaming({ extension: "md" } as any)).toBe(true);
    expect(isTFileFromFileNaming({} as any)).toBe(false);
  });

  it("createUniqueMarkdownFile добавляет суффикс если имя занято", async () => {
    const v = new FakeVault();
    await createUniqueMarkdownFile(v as any, "Ассистент/Встречи", "A", "1");
    const f2 = await createUniqueMarkdownFile(v as any, "Ассистент/Встречи", "A", "2");
    expect(f2.path).toContain("A 2.md");
  });

  it("createUniqueMarkdownFile использует запасной вариант с timestamp, если слишком много конфликтов", async () => {
    const fixedNow = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);

    const v = {
      getAbstractFileByPath: () => ({ path: "exists" }), // всё занято
      create: async (path: string, content: string) => ({ path, extension: "md", content }),
    };

    const f = await createUniqueMarkdownFile(v as any, "Ассистент/Встречи", "A", "x");
    expect(f.path).toContain(String(fixedNow));
    expect(f.path).toContain("A ");
    (Date.now as any).mockRestore?.();
  });
});
