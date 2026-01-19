import type { TAbstractFile, TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";

export function sanitizeFileName(name: string): string {
  // Remove characters forbidden in common filesystems and Obsidian paths
  // / \ : * ? " < > | and control chars
  const cleaned = (name ?? "")
    .replace(/[\/\\:\*\?"<>\|]/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Без названия";
}

export async function createUniqueMarkdownFile(
  vault: Vault,
  folderPath: string,
  baseName: string,
  content: string,
): Promise<TFile> {
  const folder = normalizePath(folderPath);
  const safeBase = sanitizeFileName(baseName);

  // Try "Name.md", then "Name 2.md", "Name 3.md", ...
  for (let i = 1; i < 10_000; i++) {
    const suffix = i === 1 ? "" : ` ${i}`;
    const filePath = normalizePath(`${folder}/${safeBase}${suffix}.md`);
    const existing = vault.getAbstractFileByPath(filePath);
    if (!existing) return await vault.create(filePath, content);
  }

  // Fallback (should never happen)
  const filePath = normalizePath(`${folder}/${safeBase} ${Date.now()}.md`);
  return await vault.create(filePath, content);
}

export function isTFile(f: TAbstractFile): f is TFile {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (f as any)?.extension != null;
}

