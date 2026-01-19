import type { TAbstractFile, TFile, Vault } from "obsidian";

/**
 * Убедиться, что файл существует в vault: если файла нет — создать с `initial`.
 *
 * @returns `TFile` для существующего или созданного файла.
 */
export async function ensureFile(vault: Vault, filePath: string, initial: string): Promise<TFile> {
  const existing = vault.getAbstractFileByPath(filePath);
  if (existing && isTFile(existing)) return existing;
  return await vault.create(filePath, initial);
}

/** Type guard для Obsidian `TFile` (консервативная runtime-проверка). */
export function isTFile(f: TAbstractFile): f is TFile {
  // Obsidian types не дают стабильного runtime-guard между версиями.
  // Используем консервативную проверку, достаточную для наших нужд.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (f as any)?.extension != null;
}
