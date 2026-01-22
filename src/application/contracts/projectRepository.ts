import type { TFile } from "obsidian";

export interface ProjectRepository {
  createAndOpen(params?: { title?: string }): Promise<TFile>;
}

