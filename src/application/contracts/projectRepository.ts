import type { VaultFileLike } from "../../shared/vaultFileLike";

export interface ProjectRepository {
  createAndOpen(params?: { title?: string }): Promise<VaultFileLike>;
}
