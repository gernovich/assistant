export type Result<T> = { ok: true; value: T } | { ok: false; error: AppErrorDto };

export type ErrorCode =
  | "E_VALIDATION"
  | "E_NOT_FOUND"
  | "E_READ_ONLY"
  | "E_OUTBOX"
  | "E_SETTINGS"
  | "E_NETWORK"
  | "E_CALDAV_AUTH"
  | "E_CALDAV_DISCOVERY"
  | "E_CALDAV_WRITEBACK"
  | "E_ICS_FETCH"
  | "E_VAULT_IO"
  | "E_FS_IO"
  | "E_RECORDING_BACKEND"
  | "E_ELECTRON_UNAVAILABLE"
  | "E_TIMEOUT"
  | "E_INTERNAL";

/**
 * Унифицированная ошибка уровня приложения.
 *
 * - `message`: безопасно показывать пользователю (UI)
 * - `cause`: безопасно логировать (уже redacted)
 */
export type AppErrorDto = {
  code: ErrorCode;
  message: string;
  cause?: string;
  details?: Record<string, unknown>;
};

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: AppErrorDto): Result<T> {
  return { ok: false, error };
}

export function isOk<T>(r: Result<T>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T>(r: Result<T>): r is { ok: false; error: AppErrorDto } {
  return !r.ok;
}
