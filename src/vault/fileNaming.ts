import type { TAbstractFile, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";

/** Очистить имя файла от запрещённых символов и лишних пробелов. */
export function sanitizeFileName(name: string): string {
  // Удаляем символы, запрещённые в популярных файловых системах и путях Obsidian:
  // / \ : * ? " < > |, а также управляющие символы.
  const cleaned = (name ?? "")
    .replace(/[\/\\:\*\?"<>\|]/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Без названия";
}

/**
 * Создать уникальный markdown-файл в папке.
 * Если имя занято — добавляем суффикс ` 2`, ` 3`, ... (до разумного лимита).
 */
export async function createUniqueMarkdownFile(vault: Vault, folderPath: string, baseName: string, content: string): Promise<TFile> {
  const folder = normalizePath(folderPath);
  const safeBase = sanitizeFileName(baseName);

  // Пытаемся "Name.md", затем "Name 2.md", "Name 3.md", ...
  for (let i = 1; i < 10_000; i++) {
    const suffix = i === 1 ? "" : ` ${i}`;
    const filePath = normalizePath(`${folder}/${safeBase}${suffix}.md`);
    const existing = vault.getAbstractFileByPath(filePath);
    if (!existing) return await vault.create(filePath, content);
  }

  // Запасной вариант (по идее не должен происходить)
  const filePath = normalizePath(`${folder}/${safeBase} ${Date.now()}.md`);
  return await vault.create(filePath, content);
}

/** Type guard для Obsidian `TFile`. */
export function isTFile(f: TAbstractFile): f is TFile {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (f as any)?.extension != null;
}
