import type { App, TFile, WorkspaceLeaf } from "obsidian";

function getLeafFilePath(leaf: WorkspaceLeaf): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyView = leaf.view as any;
  // MarkdownView имеет `.file`, но мы держим это максимально универсально.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return anyView?.file?.path as string | undefined;
}

/** Найти уже открытый markdown leaf для файла (если он открыт). */
export function findOpenLeafForFile(app: App, file: TFile): WorkspaceLeaf | undefined {
  const markdownLeaves = app.workspace.getLeavesOfType("markdown");
  for (const leaf of markdownLeaves) {
    if (getLeafFilePath(leaf) === file.path) return leaf;
  }
  return undefined;
}

/**
 * Если файл уже открыт в markdown-вкладке — просто фокусируем её.
 * Иначе открываем файл в новом leaf, чтобы не “замещать” текущий view (например, повестку).
 */
export async function revealOrOpenInNewLeaf(app: App, file: TFile): Promise<void> {
  const existing = findOpenLeafForFile(app, file);
  if (existing) {
    app.workspace.revealLeaf(existing);
    return;
  }
  const leaf = app.workspace.getLeaf(true);
  await leaf.openFile(file);
  app.workspace.revealLeaf(leaf);
}
