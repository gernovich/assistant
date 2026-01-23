import { normalizePath } from "obsidian";

export type VaultLike = {
  getAbstractFileByPath: (path: string) => unknown;
  createFolder: (path: string) => Promise<unknown>;
};

export async function ensureFolder(vault: VaultLike, folderPath: string) {
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
