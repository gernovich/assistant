import type { MetadataCachePort, VaultPort } from "../presentation/obsidian/obsidianPorts";
import { EntityIndex } from "../vault/entityIndex";

/**
 * Vault-repo / индекс проектов.
 *
 * Пока минимальный: нужен для быстрых запросов (списки/поиск) без скана vault в orchestration.
 */
export class ProjectIndex {
  private readonly entityIndex: EntityIndex;

  constructor(
    private readonly deps: {
      vault: VaultPort;
      metadataCache: MetadataCachePort;
    },
  ) {
    this.entityIndex = new EntityIndex({ vault: deps.vault, metadataCache: deps.metadataCache });
  }

  listRecent(params: { projectsRoot: string; limit: number }): Array<{ path: string; label: string }> {
    // Backward-compat: если assistant_type отсутствует, считаем, что это карточка проекта по папке.
    return this.entityIndex.listRecentByType({
      root: params.projectsRoot,
      limit: params.limit,
      assistantType: "project",
      allowMissingAssistantType: true,
    });
  }
}
