import type { AppErrorDto, ErrorCode } from "./result";

/**
 * Typed error для тех мест, где мы пока используем `throw`, но хотим переносить код ошибки/контекст.
 *
 * Важно: `message` в AppErrorDto безопасно показывать пользователю (UI).
 */
export class AppError extends Error {
  readonly dto: AppErrorDto;

  constructor(dto: AppErrorDto) {
    super(dto.message);
    this.name = "AppError";
    this.dto = dto;
  }
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && (e as any).name === "AppError" && typeof (e as any).dto === "object";
}

export function toAppErrorDto(e: unknown, fallback: { code: ErrorCode; message: string; details?: Record<string, unknown> }): AppErrorDto {
  // В некоторых окружениях (bundler / другой realm) `name` может потеряться,
  // поэтому поддерживаем структурную проверку на dto.
  if (isAppError(e)) return e.dto;
  if (typeof e === "object" && e !== null) {
    const dto = (e as any).dto as unknown;
    if (dto && typeof dto === "object" && typeof (dto as any).message === "string" && typeof (dto as any).code === "string") {
      return dto as AppErrorDto;
    }
  }

  const err = e as any;
  const msg = typeof err?.message === "string" ? String(err.message) : "";
  const message = msg.startsWith("Ассистент:") ? msg : fallback.message;

  // Причину стараемся сделать диагностируемой (stack, http status, и т.п.)
  const stack = typeof err?.stack === "string" ? String(err.stack) : "";
  const status = typeof err?.status === "number" ? String(err.status) : "";
  const statusText = typeof err?.statusText === "string" ? String(err.statusText) : "";
  const bits = [msg, status ? `HTTP ${status} ${statusText}`.trim() : "", stack].filter(Boolean);
  const cause = bits.length ? bits.join("\n") : String((e as unknown) ?? "неизвестная ошибка");

  return { code: fallback.code, message, cause, details: fallback.details };
}
