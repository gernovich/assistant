import * as fs from "node:fs/promises";
import * as path from "node:path";
import { redactSecretsInStringForLog } from "../log/redact";

export type OutboxItemKind = "set_event_partstat";

export type OutboxItemV1 = {
  version: 1;
  id: string;
  createdAtMs: number;
  kind: OutboxItemKind;
  /**
   * Payload хранится как “серый ящик”: конкретные поля зависят от kind.
   * Важно: не кладём сюда секреты (токены/пароли/URL с access_token).
   */
  payload: Record<string, unknown>;
};

type OutboxFileV1 = { version: 1; items: OutboxItemV1[] };

/**
 * Outbox (очередь изменений) для offline-first UX.
 *
 * Идея: когда действие нельзя применить сразу (например vault read-only), мы:
 * - кладём действие в outbox
 * - пишем причину в лог
 * - позже можно “применить очередь”
 */
export class OutboxService {
  private filePath: string;
  private getLogService?: () => {
    info: (m: string, data?: Record<string, unknown>) => void;
    warn: (m: string, data?: Record<string, unknown>) => void;
  };

  constructor(params: {
    filePath: string;
    logService?: () => {
      info: (m: string, data?: Record<string, unknown>) => void;
      warn: (m: string, data?: Record<string, unknown>) => void;
    };
  }) {
    this.filePath = params.filePath;
    this.getLogService = params.logService;
  }

  /** Получить текущие элементы outbox (из файла). */
  async list(): Promise<OutboxItemV1[]> {
    const f = await this.loadFile();
    return f.items;
  }

  /** Добавить элемент в outbox. */
  async enqueue(item: Omit<OutboxItemV1, "version">): Promise<void> {
    const f = await this.loadFile();
    f.items.push({ ...item, version: 1 });
    await this.saveFile(f);
    this.getLogService?.().info("Outbox: добавлено действие", { kind: item.kind, id: item.id });
  }

  /** Очистить outbox. */
  async clear(): Promise<void> {
    await this.saveFile({ version: 1, items: [] });
    this.getLogService?.().info("Outbox: очищено");
  }

  /** Заменить содержимое outbox (используется при “применении очереди”). */
  async replace(items: OutboxItemV1[]): Promise<void> {
    await this.saveFile({ version: 1, items });
  }

  private async loadFile(): Promise<OutboxFileV1> {
    if (!this.filePath) return { version: 1, items: [] };
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as OutboxFileV1;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) return { version: 1, items: [] };
      // Мягкая валидация элементов.
      return {
        version: 1,
        items: parsed.items.filter((x): x is OutboxItemV1 =>
          Boolean(x && x.version === 1 && typeof x.id === "string" && typeof x.kind === "string"),
        ),
      };
    } catch {
      return { version: 1, items: [] };
    }
  }

  private async saveFile(file: OutboxFileV1): Promise<void> {
    if (!this.filePath) return;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(file), "utf8");
    } catch (e) {
      const msg = redactSecretsInStringForLog(String((e as unknown) ?? "неизвестная ошибка"));
      this.getLogService?.().warn("Outbox: не удалось сохранить файл", { error: msg });
    }
  }
}
