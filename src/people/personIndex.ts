import type { MetadataCachePort, VaultPort } from "../presentation/obsidian/obsidianPorts";
import { normalizeEmail } from "../domain/policies/normalizeEmail";
import { FM } from "../domain/policies/frontmatterKeys";
import { EntityIndex } from "../vault/entityIndex";

/**
 * Vault-repo / индекс людей.
 *
 * Зачем:
 * - быстрые запросы (например: найти карточку человека по email) без размазывания скана vault по сервисам/use-cases
 * - централизовать правила чтения frontmatter (emails) и фильтрацию по папке
 */
export class PersonIndex {
  private readonly entityIndex: EntityIndex;

  constructor(
    private readonly deps: {
      vault: VaultPort;
      metadataCache: MetadataCachePort;
    },
  ) {
    this.entityIndex = new EntityIndex({ vault: deps.vault, metadataCache: deps.metadataCache });
  }

  findByEmail(params: { peopleRoot: string; email: string }): unknown | null {
    const email = normalizeEmail(params.email);
    if (!email) return null;

    const dirPrefix = normalizeDirPrefix(params.peopleRoot);
    const files = this.deps.vault.getMarkdownFiles() ?? [];

    for (const f of files as any[]) {
      if (!String(f?.path ?? "").startsWith(dirPrefix)) continue;

      const rawEmails = this.entityIndex.readStringArrayFromCache(f, FM.emails);
      const anyMatch = rawEmails.some((x) => normalizeEmail(String(x)) === email);
      if (anyMatch) return f;
    }

    return null;
  }

  listRecent(params: { peopleRoot: string; limit: number }): Array<{ path: string; label: string }> {
    // Backward-compat: если assistant_type отсутствует, считаем, что это карточка человека по папке.
    return this.entityIndex.listRecentByType({
      root: params.peopleRoot,
      limit: params.limit,
      assistantType: "person",
      allowMissingAssistantType: true,
    });
  }
}

function normalizeDirPrefix(root: string): string {
  const r = String(root ?? "").replace(/\/+$/g, "");
  return r ? `${r}/` : "";
}
