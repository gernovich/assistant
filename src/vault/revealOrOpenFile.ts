import type { App, TFile, WorkspaceLeaf } from "obsidian";

function getLeafFilePath(leaf: WorkspaceLeaf): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyView = leaf.view as any;
  // MarkdownView has `.file`, but we keep it generic.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return anyView?.file?.path as string | undefined;
}

export function findOpenLeafForFile(app: App, file: TFile): WorkspaceLeaf | undefined {
  const markdownLeaves = app.workspace.getLeavesOfType("markdown");
  for (const leaf of markdownLeaves) {
    if (getLeafFilePath(leaf) === file.path) return leaf;
  }
  return undefined;
}

/**
 * If the file is already open in some markdown leaf, just focus it.
 * Otherwise open in a new leaf (so we don't replace the current view like Agenda).
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

