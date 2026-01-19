import type { Vault } from "obsidian";
import { normalizePath } from "obsidian";

export async function ensureFolder(vault: Vault, folderPath: string) {
  const parts = normalizePath(folderPath).split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    const existing = vault.getAbstractFileByPath(cur);
    if (!existing) {
      await vault.createFolder(cur);
    }
  }
}

