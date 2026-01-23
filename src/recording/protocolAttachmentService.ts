import type { App } from "obsidian";
import { isTFile } from "../vault/ensureFile";
import { parseFrontmatterMap, splitFrontmatter, upsertFrontmatter } from "../vault/frontmatter";
import { FM } from "../vault/frontmatterKeys";
import { parseJsonStringArray } from "../domain/policies/frontmatterJsonArrays";

/**
 * Infrastructure service: прикрепляет файлы записи к протоколу (frontmatter `files: [...]`).
 *
 * Зачем: вынести vault I/O и сериализацию обновлений из `RecordingService` (Этап 5).
 */
export class ProtocolAttachmentService {
  private chainByProtocolPath = new Map<string, Promise<void>>();

  constructor(private app: App) {}

  async appendRecordingFile(protocolFilePath: string, recordingFilePath: string): Promise<void> {
    const run = async () => {
      const af = this.app.vault.getAbstractFileByPath(protocolFilePath);
      if (!af || !isTFile(af)) return;

      const md = await this.app.vault.read(af);
      const { frontmatter } = splitFrontmatter(md);
      const map = frontmatter ? parseFrontmatterMap(frontmatter) : {};

      const raw = String(map[FM.files] ?? "[]").trim();
      const files = parseJsonStringArray(raw);
      if (!files.includes(recordingFilePath)) files.push(recordingFilePath);

      const next = upsertFrontmatter(md, { [FM.files]: JSON.stringify(files) });
      if (next !== md) await this.app.vault.modify(af, next);
    };

    const prev = this.chainByProtocolPath.get(protocolFilePath) ?? Promise.resolve();
    const next = prev.then(run, run);
    this.chainByProtocolPath.set(protocolFilePath, next);
    try {
      await next;
    } finally {
      if (this.chainByProtocolPath.get(protocolFilePath) === next) {
        this.chainByProtocolPath.delete(protocolFilePath);
      }
    }
  }
}
