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

import { redactSecretsInStringForLog, redactUrlForLog } from "./redact";

const MAX_STRING_CHARS = 4000;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_KEYS = 200;

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

  /**
   * Создать “логгер в скоупе” (для единообразия сообщений и контекста).
   *
   * Пример:
   *   const log = base.scoped("Календарь", { opId });
   *   log.info("refresh: старт", { enabled: 2 });
   */
  scoped(scope: string, fixed?: Record<string, unknown>) {
    const prefix = String(scope ?? "").trim();
    const merge = (data?: Record<string, unknown>) => {
      if (!fixed && !data) return undefined;
      return { ...(fixed ?? {}), ...(data ?? {}) };
    };
    return {
      info: (message: string, data?: Record<string, unknown>) => this.info(prefix ? `${prefix}: ${message}` : message, merge(data)),
      warn: (message: string, data?: Record<string, unknown>) => this.warn(prefix ? `${prefix}: ${message}` : message, merge(data)),
      error: (message: string, data?: Record<string, unknown>) => this.error(prefix ? `${prefix}: ${message}` : message, merge(data)),
    };
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
    const safe = sanitizeLogEntry(e);
    this.entries.push(safe);
    this.trim();
    this.onEntry?.(safe);
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

function sanitizeLogEntry(e: LogEntry): LogEntry {
  return {
    ...e,
    message: sanitizeString(e.message),
    data: e.data ? (sanitizeUnknown(e.data, 0) as Record<string, unknown>) : undefined,
  };
}

function sanitizeString(s: string): string {
  const raw = String(s ?? "");
  // Если это URL — сначала применим URL-aware редактирование, затем общий редакт строк.
  const maybeUrl = raw.startsWith("http://") || raw.startsWith("https://");
  const step1 = maybeUrl ? redactUrlForLog(raw) : raw;
  const out = redactSecretsInStringForLog(step1);
  if (out.length > MAX_STRING_CHARS) return out.slice(0, MAX_STRING_CHARS) + "...[truncated]";
  return out;
}

function sanitizeUnknown(v: unknown, depth: number): unknown {
  if (depth > 6) return "[truncated]";
  if (v == null) return v;

  if (typeof v === "string") return sanitizeString(v);
  if (typeof v === "number" || typeof v === "boolean") return v;

  // Важно: Error — ключевой тип для диагностики. Достаём stack/cause, но санитизируем строки.
  if (v instanceof Error) {
    const anyErr = v as any;
    return {
      name: sanitizeString(v.name ?? "Error"),
      message: sanitizeString(v.message ?? ""),
      stack: v.stack ? sanitizeString(v.stack) : undefined,
      cause: anyErr?.cause != null ? sanitizeUnknown(anyErr.cause, depth + 1) : undefined,
    };
  }

  if (Array.isArray(v)) {
    // Ограничиваем размер, чтобы случайно не раздувать логи огромными объектами.
    const out = v.slice(0, MAX_ARRAY_ITEMS).map((x) => sanitizeUnknown(x, depth + 1));
    if (v.length > MAX_ARRAY_ITEMS) out.push("[truncated]");
    return out;
  }

  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    for (const k of keys.slice(0, MAX_OBJECT_KEYS)) {
      const val = obj[k];
      // Если ключ явно чувствительный — значение не пишем в логи вообще.
      if (typeof val === "string" && isSensitiveKey(k)) {
        if (isAuthorizationKey(k)) {
          // Сохраним схему (Bearer/Basic), чтобы лог был полезным, но уберём секрет.
          const m = /^(\s*(?:Bearer|Basic)\s+)(.+)$/i.exec(val);
          out[k] = m ? `${m[1]}***` : "***";
        } else {
          out[k] = "***";
        }
        continue;
      }
      // Если поле похоже на URL — применяем URL-redact точечно.
      if (typeof val === "string" && /url$/i.test(k)) {
        out[k] = sanitizeString(redactUrlForLog(val));
        continue;
      }
      out[k] = sanitizeUnknown(val, depth + 1);
    }
    if (keys.length > MAX_OBJECT_KEYS) out["[truncated]"] = `${keys.length - MAX_OBJECT_KEYS} keys`;
    return out;
  }

  return sanitizeString(String(v));
}

function isAuthorizationKey(k: string): boolean {
  return String(k ?? "").toLowerCase() === "authorization";
}

function isSensitiveKey(k: string): boolean {
  // Согласовано с `src/log/redact.ts` (SENSITIVE_KEYS) + явный Authorization header.
  return /^(access_token|refresh_token|id_token|token|code|client_secret|clientsecret|password|pass|api[_-]?key|key|authorization)$/i.test(
    String(k ?? ""),
  );
}
