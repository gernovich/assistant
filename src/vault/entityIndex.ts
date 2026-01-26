import type { MetadataCachePort, VaultPort } from "../presentation/obsidian/obsidianPorts";
import { parseJsonStringArray } from "../domain/policies/frontmatterJsonArrays";
import { parseFrontmatterMap, splitFrontmatter } from "../domain/policies/frontmatter";

/**
 * Единый индекс сущностей по `assistant_type` (meeting/protocol/person/project).
 *
 * Зачем:
 * - убрать дублирование в ProtocolIndex/PersonIndex/ProjectIndex;
 * - зафиксировать семантику обратной совместимости: если `assistant_type` отсутствует, можем считать файл сущностью по папке.
 *
 * Важно:
 * - индекс намеренно “лёгкий”: основа — `vault.getMarkdownFiles()` + `metadataCache.frontmatter`.
 * - для отдельных сценариев (например findByEmail) есть async‑резерв на чтение файла (см. `readAssistantTypeFromMd` и `readJsonStringArrayFromMd`).
 */
export class EntityIndex {
  constructor(
    private readonly deps: {
      vault: VaultPort;
      metadataCache: MetadataCachePort;
    },
  ) {}

  listRecentByType(params: {
    root: string;
    limit: number;
    assistantType: "protocol" | "person" | "project" | "calendar_event";
    /** Обратная совместимость: если assistant_type отсутствует, считаем сущностью по папке. */
    allowMissingAssistantType?: boolean;
  }): Array<{ path: string; label: string }> {
    const dirPrefix = normalizeDirPrefix(params.root);
    const limit = Math.max(1, Math.floor(Number(params.limit) || 50));
    const allowMissing = params.allowMissingAssistantType !== false;

    const files = (this.deps.vault.getMarkdownFiles() ?? []).filter((f: any) => String(f?.path ?? "").startsWith(dirPrefix));
    const filtered = files.filter((f: any) => {
      const fm = this.deps.metadataCache.getFileCache(f)?.frontmatter as any;
      const t = String(fm?.assistant_type ?? "");
      if (!t) return allowMissing;
      return t === params.assistantType;
    });

    filtered.sort((a: any, b: any) => Number(b?.stat?.mtime ?? 0) - Number(a?.stat?.mtime ?? 0));

    return filtered.slice(0, limit).map((f: any) => ({
      path: String(f?.path || ""),
      label: String(f?.basename || basenameFromPath(String(f?.path || ""))),
    }));
  }

  /**
   * Прочитать массив строк из frontmatter по ключу.
   *
   * Поддерживаем 2 формата:
   * - Obsidian parsed: key: ["a","b"] -> Array
   * - строка вида key: ["a","b"] (как в наших шаблонах) -> parseJsonStringArray
   */
  readStringArrayFromCache(file: unknown, key: string): string[] {
    const fm = (this.deps.metadataCache.getFileCache(file as any)?.frontmatter as any) ?? undefined;
    if (!fm) return [];
    const v = (fm as any)[key];
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string") as string[];
    if (typeof v === "string") return parseJsonStringArray(v).filter((x) => typeof x === "string");
    return [];
  }

  /** Async‑резерв: чтение `assistant_type` из md (если metadataCache ещё не прогрелся). */
  async readAssistantTypeFromMd(file: unknown): Promise<string> {
    try {
      const md = await this.deps.vault.read(file as any);
      const { frontmatter } = splitFrontmatter(md);
      if (!frontmatter) return "";
      const map = parseFrontmatterMap(frontmatter);
      return String(map["assistant_type"] ?? "").trim();
    } catch {
      return "";
    }
  }

  /** Async‑резерв: чтение json-строкового массива из md (например `emails: ["a"]`). */
  async readJsonStringArrayFromMd(file: unknown, key: string): Promise<string[]> {
    try {
      const md = await this.deps.vault.read(file as any);
      const { frontmatter } = splitFrontmatter(md);
      if (!frontmatter) return [];
      const map = parseFrontmatterMap(frontmatter);
      const raw = String(map[key] ?? "").trim();
      return raw ? parseJsonStringArray(raw) : [];
    } catch {
      return [];
    }
  }
}

function normalizeDirPrefix(root: string): string {
  const r = String(root).replace(/\/+$/g, "");
  return r ? `${r}/` : "";
}

function basenameFromPath(p: string): string {
  const s = String(p);
  const last = s.split("/").pop() || "";
  return last.endsWith(".md") ? last.slice(0, -3) : last;
}
