/** Уровень записи лога. */
export type LogLevel = "info" | "warn" | "error";

/** Одна запись лога (в памяти и/или в vault). */
export interface LogEntry {
  /** Unix time в мс. */
  ts: number;
  /** Уровень записи. */
  level: LogLevel;
  /** Сообщение (всегда на русском). */
  message: string;
  /** Доп. данные (для диагностики). */
  data?: Record<string, unknown>;
}

type Listener = () => void;

/**
 * In-memory лог сервиса.
 *
 * Используется:
 * - UI (LogView)
 * - запись в vault через `LogFileWriter` (через callback `onEntry`)
 */
export class LogService {
  private maxEntries: number;
  private entries: LogEntry[] = [];
  private listeners = new Set<Listener>();
  private onEntry?: (entry: LogEntry) => void;

  /** @param onEntry Коллбек на каждую новую запись (например, для записи в vault). */
  constructor(maxEntries: number, onEntry?: (entry: LogEntry) => void) {
    this.maxEntries = Math.max(10, maxEntries);
    this.onEntry = onEntry;
  }

  /** Изменить лимит записей (с обрезкой старых). */
  setMaxEntries(maxEntries: number) {
    this.maxEntries = Math.max(10, maxEntries);
    this.trim();
    this.emit();
  }

  /** Подписка на любые изменения лога (добавление/очистка). */
  onChange(cb: Listener) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Получить копию текущих записей. */
  list(): LogEntry[] {
    return this.entries.slice();
  }

  /** Записать info. */
  info(message: string, data?: Record<string, unknown>) {
    this.push({ ts: Date.now(), level: "info", message, data });
  }

  /** Записать warn. */
  warn(message: string, data?: Record<string, unknown>) {
    this.push({ ts: Date.now(), level: "warn", message, data });
  }

  /** Записать error. */
  error(message: string, data?: Record<string, unknown>) {
    this.push({ ts: Date.now(), level: "error", message, data });
  }

  /** Очистить лог (только в памяти). */
  clear() {
    this.entries = [];
    this.emit();
  }

  private push(e: LogEntry) {
    this.entries.push(e);
    this.trim();
    this.onEntry?.(e);
    this.emit();
  }

  private trim() {
    const overflow = this.entries.length - this.maxEntries;
    if (overflow > 0) this.entries.splice(0, overflow);
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }
}
