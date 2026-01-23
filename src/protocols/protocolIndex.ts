import type { MetadataCachePort, VaultPort } from "../presentation/obsidian/obsidianPorts";
import { EntityIndex } from "../vault/entityIndex";

/**
 * Vault-repo / индекс протоколов.
 *
 * Зачем:
 * - убрать прямую работу с `vault.getMarkdownFiles()`/`metadataCache` из orchestration (например `AssistantController`)
 * - централизовать эвристику "что считаем протоколом" и сортировку "последние"
 */
export class ProtocolIndex {
  private readonly entityIndex: EntityIndex;

  constructor(
    private readonly deps: {
      vault: VaultPort;
      metadataCache: MetadataCachePort;
    },
  ) {
    this.entityIndex = new EntityIndex({ vault: deps.vault, metadataCache: deps.metadataCache });
  }

  listRecent(params: { protocolsRoot: string; limit: number }): Array<{ path: string; label: string }> {
    // NOTE: backward-compat semantics preserved via `allowMissingAssistantType=true`.
    return this.getEntityIndex().listRecentByType({
      root: params.protocolsRoot,
      limit: params.limit,
      assistantType: "protocol",
      allowMissingAssistantType: true,
    });
  }

  private getEntityIndex(): EntityIndex {
    return this.entityIndex;
  }
}

