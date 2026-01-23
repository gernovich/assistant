import type { VaultFileLike } from "../../shared/vaultFileLike";

export interface PersonRepository {
  createAndOpen(params?: { displayName?: string }): Promise<VaultFileLike>;
  ensureByEmail(params: { email: string; displayName?: string }): Promise<VaultFileLike>;
}
