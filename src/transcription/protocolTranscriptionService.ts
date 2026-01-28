import type { App } from "obsidian";
import { isTFile } from "../vault/ensureFile";
import { parseJsonStringArray } from "../domain/policies/frontmatterJsonArrays";
import { parseFrontmatterMap, splitFrontmatter, upsertFrontmatter } from "../vault/frontmatter";
import { FM } from "../vault/frontmatterKeys";

/**
 * Пишет транскрипт в протокол и отмечает, какие файлы уже расшифрованы.
 *
 * Минимально:
 * - frontmatter `transcript`: JSON string array путей аудио-файлов, которые уже расшифрованы
 * - секция "### Расшифровка": добавляем markdown блоки по каждому файлу
 */
export class ProtocolTranscriptionService {
  private chainByProtocolPath = new Map<string, Promise<void>>();

  constructor(private app: App) {}

  async markFileTranscribedAndAppend(params: { protocolFilePath: string; recordingFilePath: string; transcriptMd: string }): Promise<void> {
    const run = async () => {
      const af = this.app.vault.getAbstractFileByPath(params.protocolFilePath);
      if (!af || !isTFile(af)) return;

      const md = await this.app.vault.read(af);
      const { frontmatter } = splitFrontmatter(md);
      const map = frontmatter ? parseFrontmatterMap(frontmatter) : {};

      const raw = String(map[FM.transcript] ?? "[]").trim();
      const done = parseJsonStringArray(raw);
      if (!done.includes(params.recordingFilePath)) done.push(params.recordingFilePath);

      // Обновляем frontmatter
      let next = upsertFrontmatter(md, { [FM.transcript]: JSON.stringify(done) });

      // Вставляем/добавляем текст в секцию "### Расшифровка"
      next = upsertTranscriptionSection(next, params.recordingFilePath, params.transcriptMd);

      if (next !== md) await this.app.vault.modify(af, next);
    };

    const prev = this.chainByProtocolPath.get(params.protocolFilePath) ?? Promise.resolve();
    const next = prev.then(run, run);
    this.chainByProtocolPath.set(params.protocolFilePath, next);
    try {
      await next;
    } finally {
      if (this.chainByProtocolPath.get(params.protocolFilePath) === next) {
        this.chainByProtocolPath.delete(params.protocolFilePath);
      }
    }
  }
}

function upsertTranscriptionSection(md: string, recordingFilePath: string, block: string): string {
  const marker = `<!-- assistant:nexara:${escapeForMarker(recordingFilePath)} -->`;
  if (md.includes(marker)) return md; // уже добавляли

  const sectionTitle = "### Расшифровка";
  const idx = md.indexOf(sectionTitle);
  const insertion = [marker, block.trim(), ""].join("\n");

  if (idx < 0) {
    // Нет секции — просто добавим в конец.
    return `${md.trim()}\n\n${sectionTitle}\n\n${insertion}\n`;
  }

  // Найдём конец секции (следующий "### " после текущей)
  const after = idx + sectionTitle.length;
  const nextH = md.indexOf("\n### ", after);
  if (nextH < 0) {
    return `${md.trim()}\n\n${insertion}\n`;
  }

  const before = md.slice(0, nextH);
  const rest = md.slice(nextH);
  return `${before.trimEnd()}\n\n${insertion}\n${rest.trimStart()}`;
}

function escapeForMarker(s: string): string {
  return String(s || "").replace(/-->/g, "").replace(/\n/g, " ");
}

