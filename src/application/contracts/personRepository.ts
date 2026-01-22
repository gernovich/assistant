import type { TFile } from "obsidian";

export interface PersonRepository {
  createAndOpen(params?: { displayName?: string }): Promise<TFile>;
  ensureByEmail(params: { email: string; displayName?: string }): Promise<TFile>;
}

