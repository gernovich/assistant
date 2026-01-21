import type { App } from "obsidian";
import type { LogEntry } from "./logService";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Писатель лога в системную папку плагина (вне vault).
 *
 * Пишет “батчами” с небольшой задержкой, чтобы не спамить диск на каждый log entry.
 *
 * Формат файла: компактный `.log` (одна запись = одна строка).
 */
export class LogFileWriter {
  private app: App;
  private enabled: boolean;
  private logsDirPath: string;
  private openExternal?: (path: string) => void;
  private retentionDays: number;
  private flushTimer?: number;
  private pending: LogEntry[] = [];

  constructor(params: { app: App; logsDirPath: string; enabled?: boolean; openExternal?: (path: string) => void; retentionDays?: number }) {
    this.app = params.app;
    this.logsDirPath = params.logsDirPath;
    this.enabled = params.enabled ?? true;
    this.openExternal = params.openExternal;
    this.retentionDays = normalizeRetentionDays(params.retentionDays ?? 7);
  }

  /** Включить/выключить запись в файлы (на всякий случай, не UI-настройка). */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Обновить путь папки логов (например, если изменился vault path). */
  setLogsDirPath(logsDirPath: string) {
    this.logsDirPath = logsDirPath;
  }

  /** Настроить срок хранения лог‑файлов (в днях). */
  async setRetentionDays(retentionDays: number): Promise<void> {
    this.retentionDays = normalizeRetentionDays(retentionDays);
    await this.cleanupOldLogFiles();
  }

  /** @deprecated Раньше лог писался в vault; теперь настройки логов в vault не используются. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setConfig(_folderPath: string, enabled: boolean) {
    this.enabled = enabled;
  }

  /** Поставить запись в очередь на запись в файл лога. */
  enqueue(entry: LogEntry) {
    if (!this.enabled) return;
    if (!this.logsDirPath) return;

    this.pending.push(entry);
    if (!this.flushTimer) {
      this.flushTimer = window.setTimeout(() => {
        this.flushTimer = undefined;
        void this.flush();
      }, 500);
    }
  }

  async flush() {
    if (!this.enabled) {
      this.pending = [];
      return;
    }
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;

    const folder = this.logsDirPath;
    await fs.mkdir(folder, { recursive: true });

    // Группируем по дате (YYYY-MM-DD)
    const byDate = new Map<string, LogEntry[]>();
    for (const e of batch) {
      const d = formatDateYmd(new Date(e.ts));
      const arr = byDate.get(d) ?? [];
      arr.push(e);
      byDate.set(d, arr);
    }

    for (const [ymd, entries] of byDate) {
      const filePath = path.join(folder, `${ymd}.log`);
      await ensureFileExists(filePath, "");
      const text = entries.map(formatEntry).join("\n") + "\n";
      await fs.appendFile(filePath, text, { encoding: "utf-8" });
    }

    await this.cleanupOldLogFiles();
  }

  async openTodayLog() {
    if (!this.logsDirPath) return;
    const ymd = formatDateYmd(new Date());
    const filePath = path.join(this.logsDirPath, `${ymd}.log`);
    await fs.mkdir(this.logsDirPath, { recursive: true });
    await ensureFileExists(filePath, "");

    // Файл вне vault — открываем внешним способом (в debug UI).
    if (this.openExternal) {
      this.openExternal(filePath);
    } else {
      // Фолбек: попытаемся использовать electron shell, если доступен.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const electron = require("electron") as { shell?: { openPath?: (p: string) => Promise<string> } };
        if (electron?.shell?.openPath) {
          await electron.shell.openPath(filePath);
        }
      } catch {
        // игнорируем
      }
    }
  }

  /** Очистить файл лога за сегодня (только файл, без влияния на in-memory лог). */
  async clearTodayLogFile(): Promise<void> {
    if (!this.logsDirPath) return;
    const ymd = formatDateYmd(new Date());
    const filePath = path.join(this.logsDirPath, `${ymd}.log`);
    await fs.mkdir(this.logsDirPath, { recursive: true });
    await fs.writeFile(filePath, "", { encoding: "utf-8" });
  }

  /**
   * Очистить старые лог‑файлы в папке `logsDirPath` согласно `retentionDays`.
   *
   * Правило: храним `retentionDays` дней, включая сегодняшний день.
   * Пример: retentionDays=7 → оставляем сегодня + последние 6 дней, всё старше удаляем.
   */
  async cleanupOldLogFiles(nowMs: number = Date.now()): Promise<void> {
    if (!this.logsDirPath) return;
    const keepDays = this.retentionDays;
    if (!Number.isFinite(keepDays) || keepDays <= 0) return;

    try {
      const files = await fs.readdir(this.logsDirPath);
      const nowUtcMidnight = utcMidnightMs(nowMs);
      for (const name of files) {
        // Парсим дату прямо из имени файла (YYYY-MM-DD.log), чтобы не плодить недостижимые ветки.
        const m = /^(\d{4})-(\d{2})-(\d{2})\.log$/.exec(name);
        if (!m) continue;
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const day = Number(m[3]);
        const fileUtcMidnight = Date.UTC(y, mo - 1, day);
        const ageDays = Math.floor((nowUtcMidnight - fileUtcMidnight) / MS_PER_DAY);
        if (ageDays >= keepDays) {
          await fs.rm(path.join(this.logsDirPath, name), { force: true });
        }
      }
    } catch {
      // игнорируем: папка может отсутствовать или быть недоступна
    }
  }
}

async function ensureFileExists(filePath: string, header: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, header, { encoding: "utf-8" });
  }
}

const MS_PER_DAY = 24 * 60 * 60_000;

function normalizeRetentionDays(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 7;
  return Math.min(365, Math.max(1, Math.floor(n)));
}

function utcMidnightMs(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function formatDateYmd(d: Date): string {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatEntry(e: LogEntry): string {
  const tsIso = new Date(e.ts).toISOString();
  const level = e.level.toUpperCase();
  const msg = String(e.message ?? "");
  if (!e.data || Object.keys(e.data).length === 0) return `${tsIso} ${level} ${msg}`;
  try {
    return `${tsIso} ${level} ${msg} ${JSON.stringify(e.data)}`;
  } catch {
    return `${tsIso} ${level} ${msg} ${String(e.data)}`;
  }
}

// Лог теперь пишется вне vault, поэтому ensureFile/vault utils не используются.
