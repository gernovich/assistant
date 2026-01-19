import { describe, expect, it } from "vitest";
import { ensureFolder } from "../src/vault/ensureFolder";

class FakeVault {
  private existing = new Set<string>();
  created: string[] = [];

  constructor(existing: string[] = []) {
    for (const e of existing) this.existing.add(e);
  }

  getAbstractFileByPath(path: string) {
    return this.existing.has(path) ? { path } : null;
  }

  async createFolder(path: string) {
    this.existing.add(path);
    this.created.push(path);
  }
}

describe("ensureFolder", () => {
  it("создаёт вложенные папки по частям", async () => {
    const v = new FakeVault();
    await ensureFolder(v as any, "Ассистент/Логи/2026");
    expect(v.created).toEqual(["Ассистент", "Ассистент/Логи", "Ассистент/Логи/2026"]);
  });

  it("не создаёт уже существующие сегменты", async () => {
    const v = new FakeVault(["Ассистент", "Ассистент/Логи"]);
    await ensureFolder(v as any, "Ассистент/Логи/2026");
    expect(v.created).toEqual(["Ассистент/Логи/2026"]);
  });
});
