import { describe, expect, it, vi } from "vitest";
import { findOpenLeafForFile, revealOrOpenInNewLeaf } from "../src/vault/revealOrOpenFile";

function leafWithFile(path: string) {
  return { view: { file: { path } } } as any;
}

describe("revealOrOpenFile", () => {
  it("findOpenLeafForFile находит leaf с уже открытым файлом", () => {
    const file = { path: "A.md" } as any;
    const app = {
      workspace: {
        getLeavesOfType: vi.fn().mockReturnValue([leafWithFile("X.md"), leafWithFile("A.md")]),
      },
    } as any;

    const found = findOpenLeafForFile(app, file);
    // В Obsidian тип `leaf.view` — объяснимо “широкий” (`View`), без гарантии `.file` на уровне типов.
    // В рантайме MarkdownView имеет `.file`, и именно это мы проверяем через any-каст в тесте.
    expect((found as any)?.view?.file?.path).toBe("A.md");
  });

  it("revealOrOpenInNewLeaf фокусирует существующий leaf, если файл уже открыт", async () => {
    const file = { path: "A.md" } as any;
    const existing = leafWithFile("A.md");
    const app = {
      workspace: {
        getLeavesOfType: vi.fn().mockReturnValue([existing]),
        revealLeaf: vi.fn(),
        getLeaf: vi.fn(),
      },
    } as any;

    await revealOrOpenInNewLeaf(app, file);
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existing);
    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
  });

  it("revealOrOpenInNewLeaf открывает файл в новом leaf, если он не открыт", async () => {
    const file = { path: "A.md" } as any;
    const newLeaf = { openFile: vi.fn() } as any;
    const app = {
      workspace: {
        getLeavesOfType: vi.fn().mockReturnValue([]),
        revealLeaf: vi.fn(),
        getLeaf: vi.fn().mockReturnValue(newLeaf),
      },
    } as any;

    await revealOrOpenInNewLeaf(app, file);
    expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
    expect(newLeaf.openFile).toHaveBeenCalledWith(file);
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
  });
});
