import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TFile, Vault } from "obsidian";
import { normalizePath } from "obsidian";
import { redactSecretsInStringForLog } from "../../log/redact";
import { isTFile } from "../../vault/ensureFile";

type EventNoteIndexSnapshotV1 = {
  version: 1;
  savedAtMs: number;
  eventsDir: string;
  byEventKey: Record<string, string>; // (calendar_id:event_id) -> filePath
};

/**
 * Persistent cache индекса заметок встреч: `calendar_id:event_id -> filePath`.
 *
 * Зачем:
 * - быстрый “поиск по ID” без полного сканирования vault при каждом `openEvent()`
 * - устойчивость к “красивым именам” (имя файла не часть идентичности)
 */
export class EventNoteIndexCache {
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

  /** Загрузить индекс из файла и проверить, что пути существуют в vault. */
  async load(vault: Vault, eventsDir: string): Promise<Map<string, TFile>> {
    const snap = await this.loadFile();
    const out = new Map<string, TFile>();
    if (!snap) return out;
    if (normalizePath(snap.eventsDir) !== normalizePath(eventsDir)) return out;

    const dirPrefix = normalizePath(eventsDir) + "/";
    for (const [eventKey, filePath] of Object.entries(snap.byEventKey)) {
      if (!eventKey || !filePath) continue;
      const af = vault.getAbstractFileByPath(filePath);
      if (!af || !isTFile(af)) continue;
      if (!af.path.startsWith(dirPrefix)) continue;
      out.set(eventKey, af);
    }
    return out;
  }

  /** Сохранить индекс в файл. */
  async save(params: { eventsDir: string; byEventKey: Map<string, TFile> }): Promise<void> {
    const snap: EventNoteIndexSnapshotV1 = {
      version: 1,
      savedAtMs: Date.now(),
      eventsDir: normalizePath(params.eventsDir),
      byEventKey: {},
    };
    for (const [k, f] of params.byEventKey.entries()) {
      if (!k) continue;
      snap.byEventKey[k] = f.path;
    }
    await this.saveFile(snap);
  }

  private async loadFile(): Promise<EventNoteIndexSnapshotV1 | null> {
    if (!this.filePath) return null;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as EventNoteIndexSnapshotV1;
      if (!parsed || parsed.version !== 1) return null;
      if (typeof parsed.eventsDir !== "string") return null;
      if (typeof parsed.savedAtMs !== "number") return null;
      if (!parsed.byEventKey || typeof parsed.byEventKey !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async saveFile(snap: EventNoteIndexSnapshotV1): Promise<void> {
    if (!this.filePath) return;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(snap), "utf8");
    } catch (e) {
      const msg = redactSecretsInStringForLog(String(e));
      this.getLogService?.().warn("EventNoteIndexCache: не удалось сохранить индекс", { error: msg });
    }
  }
}
